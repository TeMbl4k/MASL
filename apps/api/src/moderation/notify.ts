import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { users } from '@masl/db';
import type { OutboxService } from '../bot/outbox.service.js';
import type { DbTransaction } from '../karma/karma.service.js';

/**
 * «Новое дело» to every moderator and admin the bot may write to, except the case's subject,
 * once per case and person. In the transaction that opened the case (or set the ban).
 */
export async function notifyModerators(
  tx: DbTransaction,
  outbox: OutboxService,
  adminIds: readonly number[],
  kase: { id: string; subjectId: string },
  now: Date,
): Promise<void> {
  const moderators = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        or(
          eq(users.isModerator, true),
          adminIds.length > 0 ? inArray(users.telegramId, [...adminIds]) : undefined,
        ),
        eq(users.allowsWriteToPm, true),
        ne(users.id, kase.subjectId),
      ),
    );
  await outbox.enqueue(
    tx,
    moderators.map((m) => ({
      kind: 'moderator_new_case' as const,
      userId: m.id,
      caseId: kase.id,
      dedupeKey: `case:${kase.id}:${m.id}`,
    })),
    now,
  );
}
