import type { users } from '@masl/db';
import type { CreationBlockKind } from '@masl/shared';

type BlockColumns = Pick<
  typeof users.$inferInsert,
  'lobbyCreationBlocked' | 'creationBlockedReason' | 'creationBlockedAt' | 'creationBlockedLobbyId'
>;

/** The users columns of a creation block; the newest cause replaces an older one. */
export function creationBlock(kind: CreationBlockKind, now: Date, lobbyId: string | null): BlockColumns {
  return {
    lobbyCreationBlocked: true,
    creationBlockedReason: kind,
    creationBlockedAt: now,
    creationBlockedLobbyId: lobbyId,
  };
}

/** The users columns of a lifted block. */
export const CREATION_UNBLOCKED: BlockColumns = {
  lobbyCreationBlocked: false,
  creationBlockedReason: null,
  creationBlockedAt: null,
  creationBlockedLobbyId: null,
};
