import { and, asc, count, eq, gt, inArray, isNotNull, isNull, ne, not, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  applicationEvents,
  distanceMeters,
  geographyFrom,
  karmaEvents,
  lobbies,
  lobbyMembers,
  userInterests,
  users,
  type Database,
  type GeoPoint,
} from '@masl/db';
import {
  APP_TIME_ZONE,
  APPLICATIONS_WINDOW_HOURS,
  FEED_RANKING,
  FEED_SOON_HOURS,
  HOUR_MS,
  LOBBY_CREATE_WINDOW_HOURS,
  OCCUPYING_MEMBERSHIP_STATUSES,
  roundViewerCoord,
  type LobbyCategory,
  type LobbyStatus,
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

/** The rounded viewer origin of a query that has both coordinates or neither. */
export function originOf(query: { lat?: number; lng?: number }): GeoPoint | null {
  return query.lat !== undefined && query.lng !== undefined
    ? roundOrigin({ lat: query.lat, lng: query.lng })
    : null;
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
export function selectLobbyCards<E extends Record<string, SQL>>(
  db: Executor,
  viewerId: string,
  origin: GeoPoint | null = null,
  extra?: E,
) {
  return db
    .select({ ...lobbyCardColumns(viewerId, origin), ...(extra as E) })
    .from(lobbies)
    .innerJoin(hostUser, eq(hostUser.id, lobbies.hostId))
    .leftJoin(viewerMember, and(eq(viewerMember.lobbyId, lobbies.id), eq(viewerMember.userId, viewerId)))
    .$dynamic();
}

export type LobbyCardRow = Awaited<ReturnType<typeof selectLobbyCards<Record<never, SQL>>>>[number];

/** effectiveLobbyStatus() in SQL: a stored cancelled wins, then the time decides. */
export function effectiveStatusSql(now: Date): SQL<LobbyStatus> {
  return sql<LobbyStatus>`(case when ${lobbies.status} = 'cancelled' then 'cancelled' when ${lobbies.endsAt} <= ${at(now)} then 'finished' when ${lobbies.startsAt} <= ${at(now)} then 'active' else 'open' end)`;
}

/** Lobbies starting on the Moscow calendar day `day` ('YYYY-MM-DD'); both values are parameters. */
export function dayFilter(day: string): SQL {
  return sql`(${lobbies.startsAt} >= (${day}::date)::timestamp at time zone ${APP_TIME_ZONE} and ${lobbies.startsAt} < ((${day}::date) + 1)::timestamp at time zone ${APP_TIME_ZONE})`;
}

/** The Moscow calendar day of the start, as 'YYYY-MM-DD'. */
export const moscowDaySql = sql<string>`to_char(${lobbies.startsAt} at time zone ${APP_TIME_ZONE}, 'YYYY-MM-DD')`;

export interface DiscoverFilters {
  category?: LobbyCategory;
  day?: string;
}

const viewerPendingOrApproved = () => inArray(viewerMember.status, ['pending', 'approved']);

/**
 * What the feed, its day counts and the map may show the viewer (spec §5.7): open lobbies that
 * have not started (by `now`, not the stored status alone), not the viewer's own, not of a
 * shadow-banned host, not where the viewer was rejected or left, not full; a lobby where the
 * viewer is pending or approved stays even when full or its host is banned.
 * Needs the joins of selectLobbyCards.
 */
export function discoverableWhere(viewerId: string, now: Date, filters: DiscoverFilters = {}): SQL {
  return and(
    eq(lobbies.status, 'open'),
    gt(lobbies.startsAt, now),
    ne(lobbies.hostId, viewerId),
    or(not(hostUser.isShadowBanned), viewerPendingOrApproved()),
    or(
      isNull(viewerMember.id),
      and(
        ne(viewerMember.status, 'rejected'),
        not(and(eq(viewerMember.status, 'cancelled'), isNotNull(viewerMember.decidedAt))!),
      ),
    ),
    or(sql`${approvedCountSql} < ${lobbies.slots}`, viewerPendingOrApproved()),
    filters.category ? eq(lobbies.category, filters.category) : undefined,
    filters.day ? dayFilter(filters.day) : undefined,
  )!;
}

export interface RankingInput {
  /** Frozen ranking time: the cursor's asOf, or now on the first page. */
  asOf: Date;
  origin: GeoPoint | null;
  interests: readonly LobbyCategory[];
  viewerKarma: number;
}

/**
 * The feed ranking (spec §5.7), from public data only: start time, the "soon" bonus, distance
 * from the public point and interest match; lobbies above the viewer's karma form a lower tier.
 */
export function rankingSql(input: RankingInput): { locked: SQL<boolean>; score: SQL<string> } {
  const R = FEED_RANKING;
  const hours = sql`greatest(0, extract(epoch from (${lobbies.startsAt} - ${at(input.asOf)}))::float8 / 3600)`;
  const distance = input.origin
    ? sql`${R.WEIGHT_DISTANCE}::float8 * exp(-ST_Distance(${lobbies.publicLocation}, ${geographyFrom(input.origin)}) / ${R.DISTANCE_DECAY_M}::float8)`
    : sql`0`;
  const interest = sql`${R.WEIGHT_INTEREST}::float8 * (case when ${inArray(lobbies.category, [...input.interests])} then 1 else 0 end)`;
  const score =
    sql<string>`round((${R.WEIGHT_TIME}::float8 * exp(-${hours} / ${R.TIME_DECAY_HOURS}::float8) + ${R.WEIGHT_SOON}::float8 * (case when ${hours} <= ${FEED_SOON_HOURS}::float8 then 1 else 0 end) + ${distance} + ${interest})::numeric, 6)`.mapWith(
      String,
    );
  const locked =
    sql<boolean>`(${lobbies.minKarma} is not null and ${lobbies.minKarma} > ${input.viewerKarma}::int)`.mapWith(
      Boolean,
    );
  return { locked, score };
}

/** Rows after the cursor in feed order (locked asc, score desc, starts_at asc, id asc). */
export function afterCursor(
  rank: { locked: SQL<boolean>; score: SQL<string> },
  cursor: { locked: boolean; score: string; startsAt: Date; id: string },
): SQL {
  return sql`((case when ${rank.locked} then 1 else 0 end), -(${rank.score}), ${lobbies.startsAt}, ${lobbies.id}) > (${cursor.locked ? 1 : 0}::int, -(${cursor.score}::numeric), ${at(cursor.startsAt)}, ${cursor.id}::uuid)`;
}

/** One feed page plus one row, to know whether another page exists. */
export function feedPageQuery(
  db: Executor,
  viewerId: string,
  now: Date,
  options: {
    filters: DiscoverFilters;
    ranking: RankingInput;
    cursor: { locked: boolean; score: string; startsAt: Date; id: string } | null;
    limit: number;
  },
) {
  const rank = rankingSql(options.ranking);
  return selectLobbyCards(db, viewerId, options.ranking.origin, rank)
    .where(
      and(
        discoverableWhere(viewerId, now, options.filters),
        options.cursor ? afterCursor(rank, options.cursor) : undefined,
      ),
    )
    .orderBy(sql`${rank.locked} asc`, sql`${rank.score} desc`, asc(lobbies.startsAt), asc(lobbies.id))
    .limit(options.limit + 1);
}

/** Discoverable lobbies per Moscow day in [from, to), every filter except the day. */
export function feedDaysQuery(
  db: Executor,
  viewerId: string,
  now: Date,
  options: { category?: LobbyCategory; to: Date },
) {
  return (
    db
      .select({ day: moscowDaySql, count: count() })
      .from(lobbies)
      .innerJoin(hostUser, eq(hostUser.id, lobbies.hostId))
      .leftJoin(viewerMember, and(eq(viewerMember.lobbyId, lobbies.id), eq(viewerMember.userId, viewerId)))
      .where(
        and(
          discoverableWhere(viewerId, now, { category: options.category }),
          sql`${lobbies.startsAt} < ${at(options.to)}`,
        ),
      )
      // By position: the day expression carries a parameter, so repeating it wouldn't match.
      .groupBy(sql`1`)
  );
}

/** The earliest discoverable lobbies for the map, plus one row to detect truncation. */
export function mapLobbiesQuery(
  db: Executor,
  viewerId: string,
  now: Date,
  filters: DiscoverFilters,
  max: number,
) {
  return selectLobbyCards(db, viewerId, null)
    .where(discoverableWhere(viewerId, now, filters))
    .orderBy(asc(lobbies.startsAt), asc(lobbies.id))
    .limit(max + 1);
}

const UPCOMING_STATUSES: LobbyStatus[] = ['open', 'active'];
const PAST_STATUSES: LobbyStatus[] = ['finished', 'cancelled'];

/** The viewer's hosted lobbies, upcoming (open/active) or past (finished/cancelled). */
export function hostedLobbiesQuery(
  db: Executor,
  viewerId: string,
  now: Date,
  part: 'upcoming' | 'past',
  limit: number,
) {
  const upcoming = part === 'upcoming';
  return selectLobbyCards(db, viewerId, null)
    .where(
      and(
        eq(lobbies.hostId, viewerId),
        inArray(effectiveStatusSql(now), upcoming ? UPCOMING_STATUSES : PAST_STATUSES),
      ),
    )
    .orderBy(upcoming ? asc(lobbies.startsAt) : sql`${lobbies.startsAt} desc`, asc(lobbies.id))
    .limit(limit);
}

/**
 * Lobbies the viewer applied to. Upcoming: pending or approved on an open/active lobby. Past:
 * rejected, left, attended or no_show, plus pending/approved on a finished or cancelled lobby.
 * A withdrawn application is in neither. A shadow-banned host's lobby only while it is visible.
 */
export function joinedLobbiesQuery(
  db: Executor,
  viewerId: string,
  now: Date,
  part: 'upcoming' | 'past',
  limit: number,
) {
  const effective = effectiveStatusSql(now);
  const left = and(eq(viewerMember.status, 'cancelled'), isNotNull(viewerMember.decidedAt));
  const which =
    part === 'upcoming'
      ? and(viewerPendingOrApproved(), inArray(effective, UPCOMING_STATUSES))
      : or(
          inArray(viewerMember.status, ['rejected', 'attended', 'no_show']),
          left,
          and(viewerPendingOrApproved(), inArray(effective, PAST_STATUSES)),
        );
  return selectLobbyCards(db, viewerId, null)
    .where(
      and(
        isNotNull(viewerMember.id),
        or(
          not(hostUser.isShadowBanned),
          inArray(viewerMember.status, ['pending', 'approved', 'attended', 'no_show']),
        ),
        which,
      ),
    )
    .orderBy(part === 'upcoming' ? asc(lobbies.startsAt) : sql`${lobbies.startsAt} desc`, asc(lobbies.id))
    .limit(limit);
}

/** Profile numbers: hosted lobbies that are not cancelled, memberships taking a slot. */
export async function loadMyCounts(
  db: Executor,
  viewerId: string,
): Promise<{ hosted: number; joined: number }> {
  const [hosted] = await db
    .select({ n: count() })
    .from(lobbies)
    .where(and(eq(lobbies.hostId, viewerId), ne(lobbies.status, 'cancelled')));
  const [joined] = await db
    .select({ n: count() })
    .from(lobbyMembers)
    .where(
      and(
        eq(lobbyMembers.userId, viewerId),
        inArray(lobbyMembers.status, [...OCCUPYING_MEMBERSHIP_STATUSES]),
      ),
    );
  return { hosted: hosted?.n ?? 0, joined: joined?.n ?? 0 };
}

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

/** Locks the actor's user row, the first lock of every mutation (spec §8). False if gone. */
export async function lockUser(tx: DbTransaction, userId: string): Promise<boolean> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
  return rows.length > 0;
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
  /** Applies (renewals included) in the last APPLICATIONS_WINDOW_HOURS. */
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
  // Apply events, not rows: a withdraw and re-apply reuses the row but counts again.
  const [applied] = await db
    .select({ n: count() })
    .from(applicationEvents)
    .where(
      and(
        eq(applicationEvents.userId, userId),
        gt(applicationEvents.createdAt, new Date(now.getTime() - APPLICATIONS_WINDOW_HOURS * HOUR_MS)),
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

/** Locks the user's own membership row in the lobby (after the user and lobby locks). */
export async function lockOwnMembership(tx: DbTransaction, lobbyId: string, userId: string) {
  const [row] = await tx
    .select({
      id: lobbyMembers.id,
      status: lobbyMembers.status,
      decidedAt: lobbyMembers.decidedAt,
      chatJoinedAt: lobbyMembers.chatJoinedAt,
    })
    .from(lobbyMembers)
    .where(and(eq(lobbyMembers.lobbyId, lobbyId), eq(lobbyMembers.userId, userId)))
    .for('no key update');
  return row ?? null;
}

/**
 * Whether the host sees this application: a shadow-banned applicant is hidden unless already
 * taking a slot (spec §5.5, Q22). The list and the decisions share it, so neither reveals the ban.
 */
export const visibleToHostSql = sql<boolean>`(${or(
  not(users.isShadowBanned),
  inArray(lobbyMembers.status, [...OCCUPYING_MEMBERSHIP_STATUSES]),
)})`;

/**
 * Locks an application of this lobby for the host's decision (after the lobby lock). The
 * applicant's karma and ban flag are read without locking the user: a lobby → user lock would
 * close a cycle with apply (user → lobby). An id from another lobby finds nothing.
 */
export async function lockApplication(tx: DbTransaction, lobbyId: string, applicationId: string) {
  const [row] = await tx
    .select({
      id: lobbyMembers.id,
      userId: lobbyMembers.userId,
      status: lobbyMembers.status,
      applicantKarma: users.karma,
      visibleToHost: visibleToHostSql,
    })
    .from(lobbyMembers)
    .innerJoin(users, eq(users.id, lobbyMembers.userId))
    .where(and(eq(lobbyMembers.id, applicationId), eq(lobbyMembers.lobbyId, lobbyId)))
    .for('no key update', { of: lobbyMembers });
  return row ?? null;
}

export const attendedCountSql =
  sql<number>`(select count(*) from ${karmaEvents} where ${karmaEvents.userId} = ${users.id} and ${karmaEvents.reason} = 'attended')`.mapWith(
    Number,
  );

/**
 * The host's applications list: pending, occupying and rejected rows with the applicant's
 * public data and attended count. Withdrawn and left rows are not listed, nor rows hidden
 * from the host (`visibleToHostSql`).
 */
export function applicantsQuery(db: Executor, lobbyId: string) {
  return db
    .select({
      id: lobbyMembers.id,
      status: lobbyMembers.status,
      appliedAt: lobbyMembers.appliedAt,
      decidedAt: lobbyMembers.decidedAt,
      firstName: users.firstName,
      photoUrl: users.photoUrl,
      karma: users.karma,
      attended: attendedCountSql,
    })
    .from(lobbyMembers)
    .innerJoin(users, eq(users.id, lobbyMembers.userId))
    .where(and(eq(lobbyMembers.lobbyId, lobbyId), ne(lobbyMembers.status, 'cancelled'), visibleToHostSql))
    .orderBy(asc(lobbyMembers.appliedAt), asc(lobbyMembers.id));
}

export type ApplicantRow = Awaited<ReturnType<typeof applicantsQuery>>[number];

/** The meetup group the bot still serves for the lobby, or null. */
export async function loadActiveChat(db: Executor, lobbyId: string): Promise<number | null> {
  const [row] = await db
    .select({ chatId: lobbies.chatId })
    .from(lobbies)
    .where(and(eq(lobbies.id, lobbyId), isNotNull(lobbies.chatId), isNull(lobbies.chatClosedAt)));
  return row?.chatId ?? null;
}
