import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { moderationCases, users, type Database } from '@masl/db';
import { appealRetryAt, type AppealInput, type AppealStateDto } from '@masl/shared';
import { OutboxService } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { lockUser, type Executor } from '../lobbies/lobby-queries.js';
import { loadCreationBlock } from './admin-queries.js';
import { notifyModerators } from './notify.js';
import { openCase } from './open-case.js';

/**
 * Appeals against a creation block (spec stage 4 §2.1): one open at a time, the next one
 * APPEAL_RETRY_DAYS after a rejection. The user's own data only.
 */
@Injectable()
export class AppealsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async state(userId: string): Promise<AppealStateDto> {
    return this.stateFor(this.db, userId, this.clock.now());
  }

  async submit(userId: string, input: AppealInput): Promise<AppealStateDto> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const [user] = await tx
        .select({ blocked: users.lobbyCreationBlocked, lobbyId: users.creationBlockedLobbyId })
        .from(users)
        .where(eq(users.id, userId));
      if (!user?.blocked) throw apiError('not_blocked');
      const latest = await this.latestAppeal(tx, userId);
      if (latest && latest.resolvedAt === null) throw apiError('appeal_open');
      const retryAt = this.retryAt(latest, now);
      if (retryAt !== null) throw apiError('appeal_too_soon', { retryAt, now });
      const caseId = await openCase(
        tx,
        { kind: 'appeal', subjectId: userId, lobbyId: user.lobbyId, appealText: input.text },
        now,
      );
      if (caseId === null) throw apiError('appeal_open');
      await notifyModerators(
        tx,
        this.outbox,
        this.env.ADMIN_TELEGRAM_IDS,
        { id: caseId, subjectId: userId },
        now,
      );
      return this.stateFor(tx, userId, now);
    });
  }

  private async stateFor(db: Executor, userId: string, now: Date): Promise<AppealStateDto> {
    const block = await loadCreationBlock(db, userId);
    const latest = await this.latestAppeal(db, userId);
    const retryAt = this.retryAt(latest, now);
    const open = latest !== undefined && latest.resolvedAt === null;
    return {
      block,
      appeal: latest
        ? {
            status: open ? 'open' : latest.decision === 'appeal_approved' ? 'approved' : 'rejected',
            createdAt: latest.openedAt.toISOString(),
            decidedAt: latest.resolvedAt?.toISOString() ?? null,
            comment: latest.decision === 'appeal_rejected' ? latest.decisionComment : null,
          }
        : null,
      retryAt: retryAt?.toISOString() ?? null,
      canAppeal: block !== null && !open && retryAt === null,
    };
  }

  private async latestAppeal(db: Executor, userId: string) {
    const [latest] = await db
      .select({
        openedAt: moderationCases.openedAt,
        resolvedAt: moderationCases.resolvedAt,
        decision: moderationCases.decision,
        decisionComment: moderationCases.decisionComment,
      })
      .from(moderationCases)
      .where(and(eq(moderationCases.kind, 'appeal'), eq(moderationCases.subjectId, userId)))
      .orderBy(desc(moderationCases.openedAt), desc(moderationCases.id))
      .limit(1);
    return latest;
  }

  /** After a rejection: the moment a new appeal is allowed, while it is still ahead. */
  private retryAt(
    latest: { resolvedAt: Date | null; decision: string | null } | undefined,
    now: Date,
  ): Date | null {
    if (!latest?.resolvedAt || latest.decision !== 'appeal_rejected') return null;
    const retryAt = appealRetryAt(latest.resolvedAt);
    return retryAt > now ? retryAt : null;
  }
}
