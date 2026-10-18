import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { lobbies, lobbyFeedback, lobbyMembers, type Database } from '@masl/db';
import { FEEDBACK_MEMBERSHIP_STATUSES, type FeedbackRating, type MembershipStatus } from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { openCase } from '../moderation/open-case.js';

export type FeedbackOutcome = 'recorded' | 'repeat' | 'closed' | 'not_member';

const RATERS: readonly MembershipStatus[] = FEEDBACK_MEMBERSHIP_STATUSES;

/**
 * A member's answer to «Как прошла встреча?»: one per (lobby, user), from members who took part
 * by the host's marks so far, until attendance closes. «Не состоялась» opens a moderation case.
 */
@Injectable()
export class FeedbackService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(userId: string, lobbyId: string, rating: FeedbackRating): Promise<FeedbackOutcome> {
    const now = this.clock.now();
    const [row] = await this.db
      .select({
        status: lobbyMembers.status,
        hostId: lobbies.hostId,
        lobbyStatus: lobbies.status,
        endsAt: lobbies.endsAt,
        attendanceClosedAt: lobbies.attendanceClosedAt,
      })
      .from(lobbyMembers)
      .innerJoin(lobbies, eq(lobbies.id, lobbyMembers.lobbyId))
      .where(and(eq(lobbyMembers.lobbyId, lobbyId), eq(lobbyMembers.userId, userId)));
    if (!row || !RATERS.includes(row.status)) return 'not_member';
    const over = row.lobbyStatus !== 'cancelled' && row.endsAt <= now;
    if (!over || row.attendanceClosedAt !== null) return 'closed';
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(lobbyFeedback)
        .values({ lobbyId, userId, rating, createdAt: now })
        .onConflictDoNothing()
        .returning({ lobbyId: lobbyFeedback.lobbyId });
      if (inserted.length === 0) return 'repeat';
      // «Не состоялась» goes to moderators; later answers join the open case (stage 4 §2.1).
      if (rating === 'not_held')
        await openCase(tx, { kind: 'not_held', subjectId: row.hostId, lobbyId }, now);
      return 'recorded';
    });
  }
}
