import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { lobbies, lobbyMembers, userAchievements, userArrivals } from '@masl/db';
import {
  ACHIEVEMENTS,
  FULL_HOUSE_MIN_SLOTS,
  HOST_BADGE_ACHIEVEMENTS,
  HOST_BADGES_MAX,
  attendanceStreaks,
  type Achievement,
  type AchievementMetrics,
} from '@masl/shared';
import type { Executor } from '../lobbies/lobby-queries.js';
import { countCompanions } from '../people/companions.js';

const inShelfOrder = <T extends Achievement>(ids: T[]): T[] =>
  ids.sort((a, b) => ACHIEVEMENTS.indexOf(a) - ACHIEVEMENTS.indexOf(b));

/**
 * Everything the achievements of `userId` are counted from (stage 7). Attendance is the
 * member's mark, as for the karma; a hosted meetup is the user's lobby someone attended.
 */
export async function loadAchievementMetrics(db: Executor, userId: string): Promise<AchievementMetrics> {
  const [counts] = await db.execute<{
    attended: number;
    stations: number;
    categories: number;
    hosted: number;
    full_houses: number;
    friends: number;
  }>(sql`
    select
      (select count(*)::int from ${lobbyMembers} m
        where m.user_id = ${userId} and m.status = 'attended') as attended,
      (select count(distinct l.metro_station_id)::int from ${lobbyMembers} m
        join ${lobbies} l on l.id = m.lobby_id
        where m.user_id = ${userId} and m.status = 'attended') as stations,
      (select count(distinct l.category)::int from ${lobbyMembers} m
        join ${lobbies} l on l.id = m.lobby_id
        where m.user_id = ${userId} and m.status = 'attended') as categories,
      (select count(*)::int from ${lobbies} l
        where l.host_id = ${userId}
          and exists (select 1 from ${lobbyMembers} m where m.lobby_id = l.id and m.status = 'attended')) as hosted,
      (select count(*)::int from ${lobbies} l
        where l.host_id = ${userId} and l.slots >= ${FULL_HOUSE_MIN_SLOTS}
          and (select count(*) from ${lobbyMembers} m where m.lobby_id = l.id and m.status = 'attended') >= l.slots
      ) as full_houses,
      (select count(*)::int from ${userArrivals} a
        where a.referrer_id = ${userId}
          and exists (
            select 1 from ${lobbyMembers} m join ${lobbies} l on l.id = m.lobby_id
            where m.user_id = a.user_id and m.status = 'attended' and l.host_id <> ${userId}
          )) as friends`);
  const marks = await db
    .select({ status: lobbyMembers.status })
    .from(lobbyMembers)
    .innerJoin(lobbies, eq(lobbies.id, lobbyMembers.lobbyId))
    .where(and(eq(lobbyMembers.userId, userId), inArray(lobbyMembers.status, ['attended', 'no_show'])))
    .orderBy(asc(lobbies.endsAt), asc(lobbies.id));
  const streaks = attendanceStreaks(marks.map((m) => (m.status === 'attended' ? 'attended' : 'no_show')));
  return {
    attended: Number(counts?.attended ?? 0),
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    stations: Number(counts?.stations ?? 0),
    categories: Number(counts?.categories ?? 0),
    companions: await countCompanions(db, userId),
    hosted: Number(counts?.hosted ?? 0),
    fullHouses: Number(counts?.full_houses ?? 0),
    friends: Number(counts?.friends ?? 0),
  };
}

/** The user's earned achievements with their dates. */
export async function loadEarned(db: Executor, userId: string) {
  return db
    .select({
      id: userAchievements.achievement,
      earnedAt: userAchievements.earnedAt,
      seenAt: userAchievements.seenAt,
    })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
}

/** Earned achievements in shelf order: what others see on the profile. */
export async function loadEarnedIds(db: Executor, userId: string): Promise<Achievement[]> {
  return inShelfOrder((await loadEarned(db, userId)).map((row) => row.id));
}

/** Achievements the app hasn't shown its owner yet. */
export async function loadUnseen(db: Executor, userId: string): Promise<Achievement[]> {
  const rows = await db
    .select({ id: userAchievements.achievement })
    .from(userAchievements)
    .where(and(eq(userAchievements.userId, userId), isNull(userAchievements.seenAt)));
  return inShelfOrder(rows.map((row) => row.id));
}

type HostBadge = (typeof HOST_BADGE_ACHIEVEMENTS)[number];

/** Up to HOST_BADGES_MAX of the host's earned badges, in the order of preference. */
export async function loadHostBadges(db: Executor, hostId: string): Promise<HostBadge[]> {
  const rows = await db
    .select({ id: userAchievements.achievement })
    .from(userAchievements)
    .where(
      and(
        eq(userAchievements.userId, hostId),
        inArray(userAchievements.achievement, [...HOST_BADGE_ACHIEVEMENTS]),
      ),
    );
  const earned = new Set(rows.map((row) => row.id));
  return HOST_BADGE_ACHIEVEMENTS.filter((id) => earned.has(id)).slice(0, HOST_BADGES_MAX);
}
