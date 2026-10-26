import { and, eq } from 'drizzle-orm';
import { users } from '@masl/db';
import type { DbTransaction } from '../karma/karma.service.js';
import { CREATION_UNBLOCKED, creationBlock } from '../users/creation-block.js';

/** Sets the shadow ban; true when it changed. Under the user's lock. */
export async function setShadowBan(
  tx: DbTransaction,
  userId: string,
  banned: boolean,
  now: Date,
): Promise<boolean> {
  const changed = await tx
    .update(users)
    .set({ isShadowBanned: banned, updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.isShadowBanned, !banned)))
    .returning({ id: users.id });
  return changed.length > 0;
}

/** A moderator's creation block; it replaces an older cause. Under the user's lock. */
export async function blockCreation(
  tx: DbTransaction,
  userId: string,
  lobbyId: string | null,
  now: Date,
): Promise<void> {
  await tx
    .update(users)
    .set({ ...creationBlock('moderation', now, lobbyId), updatedAt: now })
    .where(eq(users.id, userId));
}

/** Lifts the creation block; true when there was one. Under the user's lock. */
export async function unblockCreation(tx: DbTransaction, userId: string, now: Date): Promise<boolean> {
  const changed = await tx
    .update(users)
    .set({ ...CREATION_UNBLOCKED, updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.lobbyCreationBlocked, true)))
    .returning({ id: users.id });
  return changed.length > 0;
}
