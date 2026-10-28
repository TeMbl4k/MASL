import { Inject, Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { supportRequests, users, type Database } from '@masl/db';
import {
  HOUR_MS,
  SUPPORT_PAGE_SIZE,
  SUPPORT_PER_DAY_MAX,
  SUPPORT_WINDOW_HOURS,
  type AdminSupportDto,
  type AdminSupportQuery,
  type AdminSupportResponse,
  type SupportInput,
  type SupportResponse,
} from '@masl/shared';
import { OutboxService } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { LobbiesService } from '../lobbies/lobbies.service.js';
import type { Executor } from '../lobbies/lobby-queries.js';
import { termsAccepted } from '../users/terms.js';

const author = alias(users, 'author');
const replier = alias(users, 'replier');

/** «Написать нам»: requests from users, read and answered by admins only (stage 6). */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /**
   * A new request; SUPPORT_PER_DAY_MAX a day, except for the team. Onboarding isn't needed, so
   * a problem with it can be reported too; the agreement is.
   */
  async create(userId: string, input: SupportInput): Promise<SupportResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      // The user lock keeps the daily cap under parallel requests.
      await this.lobbies.lockActor(tx, userId);
      const [user] = await tx
        .select({ termsVersion: users.termsVersion })
        .from(users)
        .where(eq(users.id, userId));
      if (!user || !termsAccepted(user)) throw apiError('terms_not_accepted');
      const viewer = await this.lobbies.viewer(tx, userId, now);
      if (!viewer.team) {
        const [sent] = await tx
          .select({ n: count() })
          .from(supportRequests)
          .where(
            and(
              eq(supportRequests.authorId, userId),
              gt(supportRequests.createdAt, new Date(now.getTime() - SUPPORT_WINDOW_HOURS * HOUR_MS)),
            ),
          );
        if ((sent?.n ?? 0) >= SUPPORT_PER_DAY_MAX) throw apiError('support_daily_limit');
      }
      const [request] = await tx
        .insert(supportRequests)
        .values({ authorId: userId, category: input.category, text: input.text, createdAt: now })
        .returning({ id: supportRequests.id });
      await this.notifyAdmins(tx, request!.id, userId, now);
      return { sent: true };
    });
  }

  /** To every admin the bot may write to, except the author. */
  private async notifyAdmins(
    tx: DbTransaction,
    supportId: string,
    authorId: string,
    now: Date,
  ): Promise<void> {
    const adminIds = this.env.ADMIN_TELEGRAM_IDS;
    if (adminIds.length === 0) return;
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.telegramId, [...adminIds]),
          eq(users.allowsWriteToPm, true),
          ne(users.id, authorId),
        ),
      );
    await this.outbox.enqueue(
      tx,
      admins.map((a) => ({ kind: 'admin_new_support' as const, userId: a.id, supportId })),
      now,
    );
  }

  /** Open requests oldest first; closed ones by the latest closed first. */
  async list(query: AdminSupportQuery): Promise<AdminSupportResponse> {
    const open = query.status === 'open';
    const rows = await this.select(this.db)
      .where(open ? isNull(supportRequests.closedAt) : isNotNull(supportRequests.closedAt))
      .orderBy(
        open ? asc(supportRequests.createdAt) : desc(supportRequests.closedAt),
        asc(supportRequests.id),
      )
      .limit(SUPPORT_PAGE_SIZE);
    const counts = await this.db
      .select({ closed: isNotNull(supportRequests.closedAt), n: count() })
      .from(supportRequests)
      .groupBy(isNotNull(supportRequests.closedAt));
    return {
      items: rows.map(toAdminSupport),
      counts: {
        open: counts.find((c) => !c.closed)?.n ?? 0,
        closed: counts.find((c) => c.closed)?.n ?? 0,
      },
    };
  }

  /** The one reply, sent to the author through the bot; it closes the request. */
  async reply(adminId: string, supportId: string, text: string): Promise<AdminSupportDto> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const request = await this.lock(tx, supportId);
      if (request.closedAt !== null) throw apiError('support_closed');
      await tx
        .update(supportRequests)
        .set({ reply: text, repliedAt: now, repliedBy: adminId, closedAt: now })
        .where(eq(supportRequests.id, supportId));
      await this.outbox.enqueue(
        tx,
        [{ kind: 'user_support_reply', userId: request.authorId, supportId }],
        now,
      );
      return this.load(tx, supportId);
    });
  }

  /** Closes without a reply; a repeat changes nothing. */
  async close(supportId: string): Promise<AdminSupportDto> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const request = await this.lock(tx, supportId);
      if (request.closedAt === null) {
        await tx.update(supportRequests).set({ closedAt: now }).where(eq(supportRequests.id, supportId));
      }
      return this.load(tx, supportId);
    });
  }

  private async lock(tx: DbTransaction, supportId: string) {
    const [request] = await tx
      .select({ authorId: supportRequests.authorId, closedAt: supportRequests.closedAt })
      .from(supportRequests)
      .where(eq(supportRequests.id, supportId))
      .for('update');
    if (!request) throw apiError('support_not_found');
    return request;
  }

  private async load(db: Executor, supportId: string): Promise<AdminSupportDto> {
    const [row] = await this.select(db).where(eq(supportRequests.id, supportId));
    if (!row) throw apiError('support_not_found');
    return toAdminSupport(row);
  }

  private select(db: Executor) {
    return db
      .select({
        id: supportRequests.id,
        category: supportRequests.category,
        text: supportRequests.text,
        createdAt: supportRequests.createdAt,
        reply: supportRequests.reply,
        repliedAt: supportRequests.repliedAt,
        closedAt: supportRequests.closedAt,
        authorId: author.id,
        authorFirstName: author.firstName,
        authorUsername: author.username,
        replierId: replier.id,
        replierFirstName: replier.firstName,
      })
      .from(supportRequests)
      .innerJoin(author, eq(author.id, supportRequests.authorId))
      .leftJoin(replier, eq(replier.id, supportRequests.repliedBy))
      .$dynamic();
  }
}

type SupportRow = Awaited<ReturnType<ReturnType<SupportService['select']>['execute']>>[number];

function toAdminSupport(row: SupportRow): AdminSupportDto {
  return {
    id: row.id,
    category: row.category,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    author: { id: row.authorId, firstName: row.authorFirstName, username: row.authorUsername },
    status: row.closedAt === null ? 'open' : 'closed',
    reply: row.reply,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    repliedBy:
      row.replierId === null || row.replierFirstName === null
        ? null
        : { id: row.replierId, firstName: row.replierFirstName },
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}
