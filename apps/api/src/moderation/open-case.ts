import { moderationCases } from '@masl/db';
import type { ModerationCaseKind } from '@masl/shared';
import type { DbTransaction } from '../karma/karma.service.js';

export interface NewCase {
  kind: ModerationCaseKind;
  subjectId: string;
  lobbyId?: string | null;
  appealText?: string | null;
}

/**
 * Opens a case; null when the same one is already open (one per kind and subject, one
 * «Не состоялась» per lobby: the partial unique indexes decide, so racing callers open one).
 */
export async function openCase(tx: DbTransaction, values: NewCase, now: Date): Promise<string | null> {
  const [created] = await tx
    .insert(moderationCases)
    .values({ ...values, openedAt: now })
    .onConflictDoNothing()
    .returning({ id: moderationCases.id });
  return created?.id ?? null;
}
