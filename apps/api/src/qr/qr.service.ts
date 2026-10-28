import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { linkTags, notifications, users, type Database } from '@masl/db';
import { HOUR_MS, QR_PRINTS_PER_DAY, QR_PRINTS_WINDOW_HOURS, type QrPrintResponse } from '@masl/shared';
import { OutboxService } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { isTeam } from '../moderation/roles.js';

/**
 * «Прислать для печати» (stage 7): the bot sends the QR as an SVG file through the outbox. The
 * daily cap counts the queued files, so a restart doesn't reset it; the team has none.
 */
@Injectable()
export class QrService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** The caller's own card: their profile link with themselves as the source. */
  async printCard(userId: string): Promise<QrPrintResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      // The user row lock serializes the count and the insert of one person's prints.
      const [user] = await tx
        .select({
          telegramId: users.telegramId,
          isModerator: users.isModerator,
          allowsWriteToPm: users.allowsWriteToPm,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for('no key update');
      if (!user) throw apiError('user_not_found');
      if (!user.allowsWriteToPm) throw apiError('bot_blocked');
      let left: number | null = null;
      if (!isTeam(user, this.env.ADMIN_TELEGRAM_IDS)) {
        const [sent] = await tx
          .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, userId),
              eq(notifications.kind, 'user_qr_print'),
              gt(notifications.createdAt, new Date(now.getTime() - QR_PRINTS_WINDOW_HOURS * HOUR_MS)),
            ),
          );
        const used = sent?.n ?? 0;
        if (used >= QR_PRINTS_PER_DAY) throw apiError('qr_prints_daily_limit');
        left = QR_PRINTS_PER_DAY - used - 1;
      }
      await this.outbox.enqueue(tx, [{ kind: 'user_qr_print', userId }], now);
      return { sent: true as const, left };
    });
  }

  /** An admin's link tag, to the admin who asked. */
  async printTag(adminId: string, tagId: number): Promise<QrPrintResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [tag] = await tx.select({ id: linkTags.id }).from(linkTags).where(eq(linkTags.id, tagId));
      if (!tag) throw apiError('tag_not_found');
      const [admin] = await tx
        .select({ allowsWriteToPm: users.allowsWriteToPm })
        .from(users)
        .where(eq(users.id, adminId));
      if (!admin?.allowsWriteToPm) throw apiError('bot_blocked');
      await this.outbox.enqueue(tx, [{ kind: 'admin_tag_qr_print', userId: adminId, tagId }], now);
      return { sent: true as const, left: null };
    });
  }
}
