import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { karmaEvents, lobbies, users, type Database } from '@masl/db';
import { KARMA, KARMA_EVENTS_LIMIT, type KarmaEventDto, type KarmaReason } from '@masl/shared';
import { DB } from '../db/db.module.js';

/** A transaction of the app database. */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface KarmaChange {
  userId: string;
  lobbyId: string | null;
  reason: KarmaReason;
  delta: number;
  now: Date;
  /** Shown to the user with manual and moderation events. */
  comment?: string | null;
}

/** Karma changes only through events: users.karma = KARMA.START + Σ karma_events.delta. */
@Injectable()
export class KarmaService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Records the event and moves users.karma in the caller's transaction; returns the delta
   * applied, or null for a repeat of the same (user, lobby, reason). A gain stops at KARMA.MAX,
   * so the event stores the clamped delta and the sum still equals the karma. No conflict
   * target: the unique index is partial (lobby_id is not null), so events without a lobby
   * always apply. The user row is locked last in the order user → lobby → membership → karma.
   */
  async apply(tx: DbTransaction, change: KarmaChange): Promise<number | null> {
    const [user] = await tx
      .select({ karma: users.karma })
      .from(users)
      .where(eq(users.id, change.userId))
      .for('no key update');
    if (!user) return null;
    const delta =
      change.delta > 0 ? Math.max(0, Math.min(change.delta, KARMA.MAX - user.karma)) : change.delta;
    const inserted = await tx
      .insert(karmaEvents)
      .values({
        userId: change.userId,
        lobbyId: change.lobbyId,
        reason: change.reason,
        delta,
        comment: change.comment ?? null,
        createdAt: change.now,
      })
      .onConflictDoNothing()
      .returning({ id: karmaEvents.id });
    if (inserted.length === 0) {
      return null;
    }
    await tx
      .update(users)
      .set({ karma: sql`${users.karma} + ${delta}`, updatedAt: change.now })
      .where(eq(users.id, change.userId));
    return delta;
  }

  /** The user's latest KARMA_EVENTS_LIMIT events, newest first, with the lobby title. */
  async listForUser(userId: string): Promise<KarmaEventDto[]> {
    const rows = await this.db
      .select({
        reason: karmaEvents.reason,
        delta: karmaEvents.delta,
        createdAt: karmaEvents.createdAt,
        lobbyId: lobbies.id,
        lobbyTitle: lobbies.title,
      })
      .from(karmaEvents)
      .leftJoin(lobbies, eq(lobbies.id, karmaEvents.lobbyId))
      .where(eq(karmaEvents.userId, userId))
      .orderBy(desc(karmaEvents.createdAt), desc(karmaEvents.id))
      .limit(KARMA_EVENTS_LIMIT);
    return rows.map((row) => ({
      reason: row.reason,
      delta: row.delta,
      createdAt: row.createdAt.toISOString(),
      lobby:
        row.lobbyId !== null && row.lobbyTitle !== null ? { id: row.lobbyId, title: row.lobbyTitle } : null,
    }));
  }
}
