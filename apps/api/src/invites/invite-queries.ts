import { and, asc, eq, ilike, inArray, isNotNull, ne, not, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { lobbyInvites, lobbyMembers, users } from '@masl/db';
import { COMPANIONS_LIST_MAX, PERSON_SEARCH_MIN, PERSON_SEARCH_RESULTS } from '@masl/shared';
import { prefixPattern, type Executor } from '../lobbies/lobby-queries.js';
import { companionsOfSql } from '../people/companions.js';

/** Who sent an invite; aliased so queries can join `users` for the invitee too. */
export const inviterUser = alias(users, 'inviter');

/** Whether a pending invite still works: the lobby is open, has not started and has places. */
export function inviteWorks(lobby: {
  effectiveStatus: string;
  approvedCount: number;
  slots: number;
}): boolean {
  return lobby.effectiveStatus === 'open' && lobby.approvedCount < lobby.slots;
}

/**
 * The viewer's unanswered invite to a lobby. An invite of a shadow-banned inviter is never
 * shown: the invitee would learn of someone hidden from them.
 */
export async function loadViewerInvite(db: Executor, lobbyId: string, viewerId: string) {
  const [row] = await db
    .select({ id: lobbyInvites.id, byHost: lobbyInvites.byHost, from: inviterUser.firstName })
    .from(lobbyInvites)
    .innerJoin(inviterUser, eq(inviterUser.id, lobbyInvites.inviterId))
    .where(
      and(
        eq(lobbyInvites.lobbyId, lobbyId),
        eq(lobbyInvites.inviteeId, viewerId),
        eq(lobbyInvites.status, 'pending'),
        not(inviterUser.isShadowBanned),
      ),
    );
  return row ?? null;
}

const candidateColumns = {
  id: users.id,
  code: users.publicCode,
  firstName: users.firstName,
  photoUrl: users.photoUrl,
};

/** People anyone may meet in the app: finished onboarding, not shadow-banned, invitable. */
const invitableWhere = () =>
  and(isNotNull(users.onboardedAt), not(users.isShadowBanned), eq(users.invitesEnabled, true));

/** A name or username prefix condition; null when the query is too short once `@` is cut. */
function nameMatch(query: string) {
  const term = query.trim();
  const byUsername = term.startsWith('@');
  const needle = byUsername ? term.slice(1) : term;
  if (needle.length < PERSON_SEARCH_MIN) return null;
  const pattern = prefixPattern(needle);
  return byUsername
    ? ilike(users.username, pattern)
    : or(ilike(users.firstName, pattern), ilike(users.username, pattern));
}

/**
 * The invite search over everyone: first name or @username prefix, never people who hide from
 * search, by name. Bounded to PERSON_SEARCH_RESULTS with no paging.
 */
export async function searchPeople(db: Executor, viewerId: string, query: string) {
  const match = nameMatch(query);
  if (!match) return [];
  return db
    .select(candidateColumns)
    .from(users)
    .where(and(ne(users.id, viewerId), invitableWhere(), eq(users.hideFromSearch, false), match))
    .orderBy(asc(users.firstName), asc(users.publicCode))
    .limit(PERSON_SEARCH_RESULTS);
}

/** The viewer's companions to invite, the most recent meeting first; search hiding doesn't apply. */
export async function companionCandidates(db: Executor, viewerId: string, query: string | undefined) {
  const match = query === undefined ? undefined : nameMatch(query);
  if (match === null) return [];
  return db
    .select(candidateColumns)
    .from(sql`${companionsOfSql(viewerId)} c`)
    .innerJoin(users, sql`${users.id} = c.user_id`)
    .where(and(invitableWhere(), match))
    .orderBy(sql`c.last_met desc`, asc(users.publicCode))
    .limit(COMPANIONS_LIST_MAX);
}

/** Ids of the viewer's companions among `ids`. */
export async function companionIds(db: Executor, viewerId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.execute<{ user_id: string }>(
    sql`select c.user_id from ${companionsOfSql(viewerId)} c where c.user_id in ${ids}`,
  );
  return new Set(rows.map((r) => r.user_id));
}

/** Invites and memberships of `ids` in the lobby, by user id. */
export async function lobbyRelations(db: Executor, lobbyId: string, ids: string[]) {
  if (ids.length === 0) return { invited: new Set<string>(), memberships: new Map() };
  const [invites, members] = await Promise.all([
    db
      .select({ userId: lobbyInvites.inviteeId })
      .from(lobbyInvites)
      .where(and(eq(lobbyInvites.lobbyId, lobbyId), inArray(lobbyInvites.inviteeId, ids))),
    db
      .select({ userId: lobbyMembers.userId, status: lobbyMembers.status, decidedAt: lobbyMembers.decidedAt })
      .from(lobbyMembers)
      .where(and(eq(lobbyMembers.lobbyId, lobbyId), inArray(lobbyMembers.userId, ids))),
  ]);
  return {
    invited: new Set(invites.map((r) => r.userId)),
    memberships: new Map(members.map((m) => [m.userId, m])),
  };
}
