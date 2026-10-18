import { moderationActions } from '@masl/db';
import type { ModerationAction } from '@masl/shared';
import type { DbTransaction } from '../karma/karma.service.js';

export interface LogEntry {
  /** Null: the system. */
  actorId: string | null;
  subjectId: string | null;
  action: ModerationAction;
  lobbyId?: string | null;
  caseId?: string | null;
  karmaDelta?: number | null;
  comment?: string | null;
}

/** Appends to the moderation log in the caller's transaction; the log is never updated. */
export async function logModeration(tx: DbTransaction, entries: LogEntry[], now: Date): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(moderationActions).values(
    entries.map((e) => ({
      actorId: e.actorId,
      subjectId: e.subjectId,
      action: e.action,
      lobbyId: e.lobbyId ?? null,
      caseId: e.caseId ?? null,
      karmaDelta: e.karmaDelta ?? null,
      comment: e.comment ?? null,
      createdAt: now,
    })),
  );
}
