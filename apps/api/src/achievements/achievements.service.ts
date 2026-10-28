import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { lobbies, lobbyMembers, userAchievements, userArrivals, type Database } from '@masl/db';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_NOTIFY_DELAY_SECONDS,
  achievementProgress,
  earnedAchievements,
  nextAchievement,
  type AchievementsSeenResponse,
  type MyAchievementsResponse,
} from '@masl/shared';
import type { OutboxMessage } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { formatRedacted, redactError } from '../errors/redacting-exception.filter.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { loadAchievementMetrics, loadEarned } from './achievement-queries.js';

/** Users whose past meetups the backfill recounts in one transaction. */
const BACKFILL_BATCH = 100;

export interface MarkedMember {
  memberId: string;
  userId: string;
}

/**
 * Achievements and friends (stage 7). Counted in the transaction of the attendance marks that
 * change them; given once and never taken back, so a repeat or a later recount adds nothing.
 */
@Injectable()
export class AchievementsService implements OnApplicationBootstrap {
  private readonly log = new Logger('Achievements');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    // Tests call backfill() themselves.
    if (this.env.NODE_ENV === 'test') return;
    this.backfill().then(
      (awarded) => {
        if (awarded > 0) this.log.log(`Ачивки за прошлые встречи: выдано ${awarded}`);
      },
      (error: unknown) => this.log.error(formatRedacted('пересчёта ачивок', redactError(error))),
    );
  }

  /**
   * Gives the users what their metrics earn now. Returns the bot message of those who got
   * something, collected for ACHIEVEMENTS_NOTIFY_DELAY_SECONDS into one.
   */
  async award(tx: DbTransaction, userIds: Iterable<string>, now: Date): Promise<OutboxMessage[]> {
    const messages: OutboxMessage[] = [];
    for (const userId of [...new Set(userIds)].sort()) {
      if ((await this.grant(tx, userId, now, false)) > 0) {
        messages.push({
          kind: 'user_achievements',
          userId,
          sendAfter: new Date(now.getTime() + ACHIEVEMENTS_NOTIFY_DELAY_SECONDS * 1000),
          dedupeKey: `achievements:${userId}`,
        });
      }
    }
    return messages;
  }

  /**
   * After a lobby's attendance marks: everyone present is recounted (their meetups, the
   * companions they share), and a friend's first meetup at another host's counts for whoever
   * brought them. A meetup of the referrer themselves never counts, so their own mark can't
   * farm the reward.
   */
  async afterAttendance(
    tx: DbTransaction,
    lobbyId: string,
    hostId: string,
    attended: readonly MarkedMember[],
    now: Date,
  ): Promise<OutboxMessage[]> {
    if (attended.length === 0) return [];
    const messages: OutboxMessage[] = [];
    const referrers: string[] = [];
    for (const member of attended) {
      const [arrival] = await tx
        .select({ referrerId: userArrivals.referrerId })
        .from(userArrivals)
        .where(and(eq(userArrivals.userId, member.userId), isNotNull(userArrivals.referrerId)));
      const referrerId = arrival?.referrerId;
      if (!referrerId || referrerId === hostId) continue;
      const [meetups] = await tx
        .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
        .from(lobbyMembers)
        .innerJoin(lobbies, eq(lobbies.id, lobbyMembers.lobbyId))
        .where(
          and(
            eq(lobbyMembers.userId, member.userId),
            eq(lobbyMembers.status, 'attended'),
            ne(lobbies.hostId, referrerId),
          ),
        );
      if (meetups?.n !== 1) continue;
      referrers.push(referrerId);
      messages.push({ kind: 'user_friend_counted', userId: referrerId, lobbyId, memberId: member.memberId });
    }
    const present = [hostId, ...attended.map((m) => m.userId)];
    messages.push(...(await this.award(tx, [...present, ...referrers], now)));
    return messages;
  }

  /** «Мои ачивки» and «Пригласить друзей»: the owner's own data only. */
  async mine(userId: string): Promise<MyAchievementsResponse> {
    const [metrics, rows, arrived] = await Promise.all([
      loadAchievementMetrics(this.db, userId),
      loadEarned(this.db, userId),
      this.db
        .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
        .from(userArrivals)
        .where(eq(userArrivals.referrerId, userId)),
    ]);
    const earned = new Map(rows.map((row) => [row.id, row.earnedAt]));
    return {
      items: ACHIEVEMENTS.map((id) => {
        const earnedAt = earned.get(id) ?? null;
        const progress = achievementProgress(metrics, id);
        return {
          id,
          earnedAt: earnedAt?.toISOString() ?? null,
          current: earnedAt ? progress.goal : progress.current,
          goal: progress.goal,
        };
      }),
      next: nextAchievement(metrics, new Set(earned.keys())),
      friends: { arrived: arrived[0]?.n ?? 0, reached: metrics.friends },
    };
  }

  /** «Новая ачивка» was shown: it isn't shown again. */
  async markSeen(userId: string): Promise<AchievementsSeenResponse> {
    const seen = await this.db
      .update(userAchievements)
      .set({ seenAt: this.clock.now() })
      .where(and(eq(userAchievements.userId, userId), isNull(userAchievements.seenAt)))
      .returning({ id: userAchievements.achievement });
    return { seen: seen.length };
  }

  /**
   * Recounts everyone with a marked meetup, a hosted one or a friend, without bot messages:
   * achievements of past meetups (the deploy of stage 7) and anything a message would have
   * missed. Returns how many were given.
   */
  async backfill(): Promise<number> {
    const rows = await this.db.execute<{ id: string }>(sql`
      select distinct user_id as id from ${lobbyMembers} where status in ('attended', 'no_show')
      union
      select distinct l.host_id from ${lobbies} l
      where exists (select 1 from ${lobbyMembers} m where m.lobby_id = l.id and m.status = 'attended')
      union
      select distinct referrer_id from ${userArrivals} where referrer_id is not null
      order by id`);
    const ids = rows.map((row) => row.id);
    let awarded = 0;
    for (let i = 0; i < ids.length; i += BACKFILL_BATCH) {
      const batch = ids.slice(i, i + BACKFILL_BATCH);
      awarded += await this.db.transaction(async (tx) => {
        let given = 0;
        for (const userId of batch) given += await this.grant(tx, userId, this.clock.now(), true);
        return given;
      });
    }
    return awarded;
  }

  /** Inserts what the user's metrics earn and has no row yet; returns how many were new. */
  private async grant(tx: DbTransaction, userId: string, now: Date, silent: boolean): Promise<number> {
    const earned = earnedAchievements(await loadAchievementMetrics(tx, userId));
    if (earned.length === 0) return 0;
    const inserted = await tx
      .insert(userAchievements)
      .values(earned.map((achievement) => ({ userId, achievement, earnedAt: now, silent })))
      .onConflictDoNothing()
      .returning({ id: userAchievements.achievement });
    return inserted.length;
  }
}
