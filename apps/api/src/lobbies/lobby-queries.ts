import { and, asc, count, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  distanceMeters,
  karmaEvents,
  lobbies,
  lobbyMembers,
  userInterests,
  users,
  type Database,
  type GeoPoint,
} from '@masl/db';
import {
  APPLICATIONS_WINDOW_HOURS,
  HOUR_MS,
  LOBBY_CREATE_WINDOW_HOURS,
  OCCUPYING_MEMBERSHIP_STATUSES,
  roundViewerCoord,
  type LobbyCategory,
} from '@masl/shared';
import type { DbTransaction } from '../karma/karma.service.js';

/**
 * Query builders of the lobby module. Public builders never read the exact place
 * (`lobbies.location`, `lobbies.address`): they select only `publicLobbyColumns`, and the exact
 * columns are read by `loadExactPlace` alone, which runs only when access allows (spec §6.1 S5).
 */

/** The app database or a transaction of it. */
export type Executor = Database | DbTransaction;

/**
 * A timestamp parameter for raw sql``: the postgres.js driver under Drizzle can't bind a Date
 * outside a column context, so it goes as ISO text with an explicit cast.
 */
export const at = (instant: Date): SQL => sql`${instant.toISOString()}::timestamptz`;

/** The viewer origin rounded to VIEWER_COORD_DECIMALS (the query schema rounds too). */
export function roundOrigin(origin: GeoPoint | null | undefined): GeoPoint | null {
  return origin ? { lat: roundViewerCoord(origin.lat), lng: roundViewerCoord(origin.lng) } : null;
}

/** The lobby's host; aliased so subqueries can use `users` unqualified. */
export const hostUser = alias(users, 'host');
/** The viewer's own membership row in the lobby, if any. */
export const viewerMember = alias(lobbyMembers, 'viewer_member');

/** Every lobby column the public may derive data from. No `location`, no `address`. */
export const publicLobbyColumns = {
  id: lobbies.id,
  hostId: lobbies.hostId,
  category: lobbies.category,
  title: lobbies.title,
  description: lobbies.description,
  startsAt: lobbies.startsAt,
  endsAt: lobbies.endsAt,
  status: lobbies.status,
  slots: lobbies.slots,
  minKarma: lobbies.minKarma,
  paymentFormat: lobbies.paymentFormat,
  placeHint: lobbies.placeHint,
  metroStationId: lobbies.metroStationId,
  publicLocation: lobbies.publicLocation,
  farFromMetro: lobbies.farFromMetro,
  cancelReason: lobbies.cancelReason,
  cancelComment: lobbies.cancelComment,
} as const;

/** Members taking a slot (approved, attended, no_show). */
export const approvedCountSql =
  sql<number>`(select count(*) from ${lobbyMembers} where ${lobbyMembers.lobbyId} = ${lobbies.id} and ${inArray(lobbyMembers.status, [...OCCUPYING_MEMBERSHIP_STATUSES])})`.mapWith(
    Number,
  );

/** Pending applications the host sees: shadow-banned applicants are left out. */
const pendingCountSql =
  sql<number>`(select count(*) from ${lobbyMembers} inner join ${users} on ${users.id} = ${lobbyMembers.userId} where ${lobbyMembers.lobbyId} = ${lobbies.id} and ${lobbyMembers.status} = 'pending' and not ${users.isShadowBanned})`.mapWith(
    Number,
  );

/**
 * Columns of a lobby card as `viewerId` sees it. `pendingCount` is computed for the host only;
 * `distanceM` is the raw distance from the public point to the (rounded) origin.
 */
function lobbyCardColumns(viewerId: string, origin: GeoPoint | null) {
  return {
    ...publicLobbyColumns,
    hostFirstName: hostUser.firstName,
    hostPhotoUrl: hostUser.photoUrl,
    hostKarma: hostUser.karma,
    hostShadowBanned: hostUser.isShadowBanned,
    approvedCount: approvedCountSql,
    pendingCount: sql<
      number | null
    >`case when ${lobbies.hostId} = ${viewerId} then ${pendingCountSql} end`.mapWith((value: unknown) =>
      value === null ? null : Number(value),
    ),
    memberStatus: viewerMember.status,
    memberDecidedAt: viewerMember.decidedAt,
    distanceM: origin
      ? distanceMeters(lobbies.publicLocation, origin)
      : sql<number | null>`null`.mapWith((value: unknown) => (value === null ? null : Number(value))),
  };
}

/**
 * The public card query: lobby, host and the viewer's membership. Callers add where/order/limit.
 */
export function selectLobbyCards(db: Executor, viewerId: string, origin: GeoPoint | null = null) {
  return db
    .select(lobbyCardColumns(viewerId, origin))
    .from(lobbies)
    .innerJoin(hostUser, eq(hostUser.id, lobbies.hostId))
    .leftJoin(viewerMember, and(eq(viewerMember.lobbyId, lobbies.id), eq(viewerMember.userId, viewerId)))
    .$dynamic();
}

export type LobbyCardRow = Awaited<ReturnType<typeof selectLobbyCards>>[number];

/**
 * One lobby as the viewer would see it, whether or not it is visible to them: hidden and
 * missing lobbies take the same query, the access decision is made in TypeScript.
 */
export function lobbyForViewerQuery(
  db: Executor,
  lobbyId: string,
  viewerId: string,
  origin: GeoPoint | null,
) {
  return selectLobbyCards(db, viewerId, origin).where(eq(lobbies.id, lobbyId));
}

export async function loadLobbyForViewer(
  db: Executor,
  lobbyId: string,
  viewerId: string,
  origin: GeoPoint | null,
): Promise<LobbyCardRow | null> {
  const [row] = await lobbyForViewerQuery(db, lobbyId, viewerId, origin);
  return row ?? null;
}

/** The exact place query; run only after resolveLobbyAccess allowed it. */
export function exactPlaceQuery(db: Executor, lobbyId: string) {
  return db
    .select({ address: lobbies.address, point: lobbies.location })
    .from(lobbies)
    .where(eq(lobbies.id, lobbyId));
}

export async function loadExactPlace(
  db: Executor,
  lobbyId: string,
): Promise<{ address: string; point: GeoPoint } | null> {
  const [row] = await exactPlaceQuery(db, lobbyId);
  return row ?? null;
}

/** Members taking a slot, in the order they were admitted (the host is not in the list). */
export function membersQuery(db: Executor, lobbyId: string) {
  return db
    .select({ firstName: users.firstName, photoUrl: users.photoUrl, karma: users.karma })
    .from(lobbyMembers)
    .innerJoin(users, eq(users.id, lobbyMembers.userId))
    .where(
      and(
        eq(lobbyMembers.lobbyId, lobbyId),
        inArray(lobbyMembers.status, [...OCCUPYING_MEMBERSHIP_STATUSES]),
      ),
    )
    .orderBy(asc(lobbyMembers.decidedAt), asc(lobbyMembers.id));
}

/** Locks the lobby row for a mutation (lock order: user → lobby → membership). */
export async function lockLobby(tx: DbTransaction, lobbyId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(eq(lobbies.id, lobbyId))
    .for('no key update');
  return rows.length > 0;
}

/** What the per-request viewer checks need, loaded once per request, not per card. */
export interface ViewerContext {
  userId: string;
  karma: number;
  onboarded: boolean;
  lobbyCreationBlocked: boolean;
  interests: LobbyCategory[];
  /** Pending applications on lobbies that have not started and are not cancelled. */
  pendingApplications: number;
  /** Applications made in the last APPLICATIONS_WINDOW_HOURS. */
  applicationsInWindow: number;
}

/**
 * The viewer context, or null if the user no longer exists. In a mutation, call it after the
 * user row is locked so the counters can't change underneath.
 */
export async function loadViewerContext(
  db: Executor,
  userId: string,
  now: Date,
): Promise<ViewerContext | null> {
  const [user] = await db
    .select({
      karma: users.karma,
      onboardedAt: users.onboardedAt,
      lobbyCreationBlocked: users.lobbyCreationBlocked,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const interestRows = await db
    .select({ slug: userInterests.interestSlug })
    .from(userInterests)
    .where(eq(userInterests.userId, userId))
    .orderBy(asc(userInterests.interestSlug));
  const [pending] = await db
    .select({ n: count() })
    .from(lobbyMembers)
    .innerJoin(lobbies, eq(lobbies.id, lobbyMembers.lobbyId))
    .where(
      and(
        eq(lobbyMembers.userId, userId),
        eq(lobbyMembers.status, 'pending'),
        gt(lobbies.startsAt, now),
        ne(lobbies.status, 'cancelled'),
      ),
    );
  const [applied] = await db
    .select({ n: count() })
    .from(lobbyMembers)
    .where(
      and(
        eq(lobbyMembers.userId, userId),
        gt(lobbyMembers.appliedAt, new Date(now.getTime() - APPLICATIONS_WINDOW_HOURS * HOUR_MS)),
      ),
    );
  return {
    userId,
    karma: user.karma,
    onboarded: user.onboardedAt !== null,
    lobbyCreationBlocked: user.lobbyCreationBlocked,
    // Interest slugs and lobby categories share their values (decisions.md).
    interests: interestRows.map((r) => r.slug as LobbyCategory),
    pendingApplications: pending?.n ?? 0,
    applicationsInWindow: applied?.n ?? 0,
  };
}

/** Counters behind the lobby creation limits (spec §2.1). */
export interface CreationCounters {
  attended: number;
  /** created_at of the user's lobbies in the rolling window, oldest first; cancelled ones count. */
  createdInWindow: Date[];
  /** Hosted lobbies that are not cancelled and have not ended. */
  upcoming: number;
}

export async function loadCreationCounters(
  db: Executor,
  userId: string,
  now: Date,
): Promise<CreationCounters> {
  const [attended] = await db
    .select({ n: count() })
    .from(karmaEvents)
    .where(and(eq(karmaEvents.userId, userId), eq(karmaEvents.reason, 'attended')));
  const created = await db
    .select({ createdAt: lobbies.createdAt })
    .from(lobbies)
    .where(
      and(
        eq(lobbies.hostId, userId),
        gt(lobbies.createdAt, new Date(now.getTime() - LOBBY_CREATE_WINDOW_HOURS * HOUR_MS)),
      ),
    )
    .orderBy(asc(lobbies.createdAt));
  const [upcoming] = await db
    .select({ n: count() })
    .from(lobbies)
    .where(and(eq(lobbies.hostId, userId), ne(lobbies.status, 'cancelled'), gt(lobbies.endsAt, now)));
  return {
    attended: attended?.n ?? 0,
    createdInWindow: created.map((r) => r.createdAt),
    upcoming: upcoming?.n ?? 0,
  };
}
