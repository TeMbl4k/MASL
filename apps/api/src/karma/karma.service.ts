import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { karmaEvents, users, type Database } from '@masl/db';
import type { KarmaReason } from '@masl/shared';

/** A transaction of the app database. */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface KarmaChange {
  userId: string;
  lobbyId: string | null;
  reason: KarmaReason;
  delta: number;
  now: Date;
}

/** Karma changes only through events: users.karma = KARMA.START + Σ karma_events.delta. */
@Injectable()
export class KarmaService {
  /**
   * Records the event and moves users.karma in the caller's transaction. A repeat for the same
   * (user, lobby, reason) is a no-op and returns false. No conflict target: the unique index is
   * partial (lobby_id is not null), so events without a lobby always apply.
   */
  async apply(tx: DbTransaction, change: KarmaChange): Promise<boolean> {
    const inserted = await tx
      .insert(karmaEvents)
      .values({
        userId: change.userId,
        lobbyId: change.lobbyId,
        reason: change.reason,
        delta: change.delta,
        createdAt: change.now,
      })
      .onConflictDoNothing()
      .returning({ id: karmaEvents.id });
    if (inserted.length === 0) {
      return false;
    }
    await tx
      .update(users)
      .set({ karma: sql`${users.karma} + ${change.delta}`, updatedAt: change.now })
      .where(eq(users.id, change.userId));
    return true;
  }
}
