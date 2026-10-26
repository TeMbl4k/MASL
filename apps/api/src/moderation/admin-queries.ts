import { and, asc, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import { karmaEvents, lobbies, lobbyFeedback, lobbyMembers, moderationCases, reports, users } from '@masl/db';
import {
  KARMA,
  OCCUPYING_MEMBERSHIP_STATUSES,
  effectiveLobbyStatus,
  type AdminLobbyDto,
  type AdminUserDto,
  type AdminUserStatsDto,
  type CreationBlockDto,
  type KarmaReason,
} from '@masl/shared';
import { parseCancelReason } from '../lobbies/lobby.mapper.js';
import { approvedCountSql, effectiveStatusSql, type Executor } from '../lobbies/lobby-queries.js';
import { userRole } from './roles.js';

/**
 * Reads behind the moderators' screens. Moderators see people and lobbies in full, except the
 * exact place: nothing here selects `lobbies.location` or `lobbies.address` (rule 13).
 */

const adminUserColumns = {
  id: users.id,
  telegramId: users.telegramId,
  firstName: users.firstName,
  lastName: users.lastName,
  username: users.username,
  photoUrl: users.photoUrl,
  karma: users.karma,
  isModerator: users.isModerator,
  isShadowBanned: users.isShadowBanned,
  creationBlockedReason: users.creationBlockedReason,
  onboardedAt: users.onboardedAt,
  createdAt: users.createdAt,
};

export function selectAdminUsers(db: Executor) {
  return db.select(adminUserColumns).from(users).$dynamic();
}

type AdminUserRow = Awaited<ReturnType<typeof selectAdminUsers>>[number];

export function toAdminUser(row: AdminUserRow, adminIds: readonly number[]): AdminUserDto {
  return {
    id: row.id,
    telegramId: row.telegramId,
    firstName: row.firstName,
    lastName: row.lastName,
    username: row.username,
    photoUrl: row.photoUrl,
    karma: row.karma,
    role: userRole(row, adminIds),
    isShadowBanned: row.isShadowBanned,
    creationBlock: row.creationBlockedReason,
    onboarded: row.onboardedAt !== null,
    joinedAt: row.createdAt.toISOString(),
  };
}

export async function loadAdminUser(
  db: Executor,
  userId: string,
  adminIds: readonly number[],
): Promise<AdminUserDto | null> {
  const [row] = await selectAdminUsers(db).where(eq(users.id, userId));
  return row ? toAdminUser(row, adminIds) : null;
}

async function countOf(query: PromiseLike<{ n: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.n ?? 0;
}

export async function loadUserStats(db: Executor, userId: string): Promise<AdminUserStatsDto> {
  const memberships = (status: 'attended' | 'no_show') =>
    countOf(
      db
        .select({ n: count() })
        .from(lobbyMembers)
        .where(and(eq(lobbyMembers.userId, userId), eq(lobbyMembers.status, status))),
    );
  const karmaCount = (reason: KarmaReason) =>
    countOf(
      db
        .select({ n: count() })
        .from(karmaEvents)
        .where(and(eq(karmaEvents.userId, userId), eq(karmaEvents.reason, reason))),
    );
  const hosted = await countOf(
    db
      .select({ n: count() })
      .from(lobbies)
      .where(and(eq(lobbies.hostId, userId), ne(lobbies.status, 'cancelled'))),
  );
  const attended = await memberships('attended');
  const noShows = await memberships('no_show');
  const lateCancels = await karmaCount('late_cancel');
  const hostLateCancels = await karmaCount('host_late_cancel');
  const reportsReceived = await countOf(
    db.select({ n: count() }).from(reports).where(eq(reports.subjectId, userId)),
  );
  const ratings = await db
    .select({ rating: lobbyFeedback.rating, n: count() })
    .from(lobbyFeedback)
    .innerJoin(lobbies, eq(lobbies.id, lobbyFeedback.lobbyId))
    .where(eq(lobbies.hostId, userId))
    .groupBy(lobbyFeedback.rating);
  const rated = (rating: string) => ratings.find((r) => r.rating === rating)?.n ?? 0;
  return {
    hosted,
    attended,
    noShows,
    lateCancels,
    hostLateCancels,
    reportsReceived,
    feedback: { good: rated('good'), bad: rated('bad'), notHeld: rated('not_held') },
  };
}

/** The karma event that comes with each kind of creation block on its lobby. */
export const BLOCK_PENALTY_REASONS = ['host_late_cancel', 'moderation'] as const satisfies KarmaReason[];

/** The user's creation block with its lobby and what it cost; null when creation is allowed. */
export async function loadCreationBlock(db: Executor, userId: string): Promise<CreationBlockDto | null> {
  const [row] = await db
    .select({
      kind: users.creationBlockedReason,
      since: users.creationBlockedAt,
      lobbyId: users.creationBlockedLobbyId,
      title: lobbies.title,
      startsAt: lobbies.startsAt,
      cancelledAt: lobbies.cancelledAt,
    })
    .from(users)
    .leftJoin(lobbies, eq(lobbies.id, users.creationBlockedLobbyId))
    .where(eq(users.id, userId));
  if (!row?.kind || !row.since) return null;
  const penalty = row.lobbyId === null ? null : await loadPenalty(db, userId, row.lobbyId);
  return {
    kind: row.kind,
    since: row.since.toISOString(),
    lobby:
      row.title !== null && row.startsAt !== null
        ? {
            title: row.title,
            startsAt: row.startsAt.toISOString(),
            cancelledAt: row.cancelledAt?.toISOString() ?? null,
          }
        : null,
    karmaDelta: penalty,
  };
}

/** What a block's cause cost the user on that lobby (a host late cancel, a moderator's «сорвал»). */
export async function loadPenalty(db: Executor, userId: string, lobbyId: string): Promise<number | null> {
  const rows = await db
    .select({ delta: karmaEvents.delta })
    .from(karmaEvents)
    .where(
      and(
        eq(karmaEvents.userId, userId),
        eq(karmaEvents.lobbyId, lobbyId),
        inArray(karmaEvents.reason, [...BLOCK_PENALTY_REASONS]),
      ),
    );
  return rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.delta, 0);
}

/**
 * The karma «Вернуть карму» gives back for the block's lobby: the penalty, once, up to
 * KARMA.MAX. Zero without a penalty or after a refund.
 */
export async function loadAppealRefund(
  db: Executor,
  user: { id: string; karma: number },
  lobbyId: string | null,
): Promise<number> {
  if (lobbyId === null) return 0;
  const penalty = await loadPenalty(db, user.id, lobbyId);
  if (penalty === null || penalty >= 0) return 0;
  const refunded = await countOf(
    db
      .select({ n: count() })
      .from(karmaEvents)
      .where(
        and(
          eq(karmaEvents.userId, user.id),
          eq(karmaEvents.lobbyId, lobbyId),
          eq(karmaEvents.reason, 'appeal_refund'),
        ),
      ),
  );
  if (refunded > 0) return 0;
  return Math.max(0, Math.min(-penalty, KARMA.MAX - user.karma));
}

/** The host's open lobbies that have not started, oldest id first (the lock order). */
export async function upcomingLobbyIds(db: Executor, hostId: string, now: Date): Promise<string[]> {
  const rows = await db
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(and(eq(lobbies.hostId, hostId), eq(effectiveStatusSql(now), 'open')))
    .orderBy(asc(lobbies.id));
  return rows.map((row) => row.id);
}

export async function countOpenCases(db: Executor): Promise<number> {
  return countOf(db.select({ n: count() }).from(moderationCases).where(isNull(moderationCases.resolvedAt)));
}

/** The lobby with everyone who took a slot, their marks, answers and karma on it. */
export async function loadAdminLobby(
  db: Executor,
  lobbyId: string,
  now: Date,
): Promise<AdminLobbyDto | null> {
  const [lobby] = await db
    .select({
      id: lobbies.id,
      hostId: lobbies.hostId,
      title: lobbies.title,
      description: lobbies.description,
      category: lobbies.category,
      startsAt: lobbies.startsAt,
      endsAt: lobbies.endsAt,
      status: lobbies.status,
      placeHint: lobbies.placeHint,
      slots: lobbies.slots,
      approvedCount: approvedCountSql,
      cancelReason: lobbies.cancelReason,
      cancelledAt: lobbies.cancelledAt,
      attendanceSavedAt: lobbies.attendanceSavedAt,
    })
    .from(lobbies)
    .where(eq(lobbies.id, lobbyId));
  if (!lobby) return null;
  const members = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      karma: users.karma,
      status: lobbyMembers.status,
      checkedInAt: lobbyMembers.checkedInAt,
      feedback: lobbyFeedback.rating,
    })
    .from(lobbyMembers)
    .innerJoin(users, eq(users.id, lobbyMembers.userId))
    .leftJoin(
      lobbyFeedback,
      and(eq(lobbyFeedback.lobbyId, lobbyMembers.lobbyId), eq(lobbyFeedback.userId, lobbyMembers.userId)),
    )
    .where(
      and(
        eq(lobbyMembers.lobbyId, lobbyId),
        inArray(lobbyMembers.status, [...OCCUPYING_MEMBERSHIP_STATUSES]),
      ),
    )
    .orderBy(asc(lobbyMembers.decidedAt), asc(lobbyMembers.id));
  const events = await db
    .select({ userId: karmaEvents.userId, reason: karmaEvents.reason, delta: karmaEvents.delta })
    .from(karmaEvents)
    .where(
      and(eq(karmaEvents.lobbyId, lobbyId), inArray(karmaEvents.reason, ['attended', 'no_show', 'hosted'])),
    );
  const deltaOf = (userId: string, reasons: readonly KarmaReason[]) => {
    const own = events.filter((e) => e.userId === userId && reasons.includes(e.reason));
    return own.length === 0 ? null : own.reduce((sum, e) => sum + e.delta, 0);
  };
  return {
    id: lobby.id,
    title: lobby.title,
    description: lobby.description,
    category: lobby.category,
    startsAt: lobby.startsAt.toISOString(),
    endsAt: lobby.endsAt.toISOString(),
    status: effectiveLobbyStatus(lobby, now),
    placeHint: lobby.placeHint,
    slots: lobby.slots,
    approvedCount: lobby.approvedCount,
    cancelReason: parseCancelReason(lobby.cancelReason),
    cancelledAt: lobby.cancelledAt?.toISOString() ?? null,
    attendanceSavedAt: lobby.attendanceSavedAt?.toISOString() ?? null,
    hostedDelta: deltaOf(lobby.hostId, ['hosted']),
    members: members.map((m) => ({
      user: { id: m.userId, firstName: m.firstName, karma: m.karma },
      status: m.status,
      checkedInAt: m.checkedInAt?.toISOString() ?? null,
      feedback: m.feedback,
      karmaDelta: deltaOf(m.userId, ['attended', 'no_show']),
    })),
  };
}
