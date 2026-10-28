import { sql, type SQL } from 'drizzle-orm';
import { lobbies, lobbyMembers, users } from '@masl/db';
import type { Executor } from '../lobbies/lobby-queries.js';

/**
 * Companions (spec stage 6): people marked present at one meetup with the user. Present are the
 * attended members of a lobby, and its host once anyone attended. Applications and approvals
 * alone never make companions, so they can't be farmed.
 */
const presentSql: SQL = sql`(
  select ${lobbyMembers.lobbyId} as lobby_id, ${lobbyMembers.userId} as user_id
  from ${lobbyMembers} where ${lobbyMembers.status} = 'attended'
  union
  select ${lobbies.id} as lobby_id, ${lobbies.hostId} as user_id from ${lobbies}
  where exists (
    select 1 from ${lobbyMembers} where ${lobbyMembers.lobbyId} = ${lobbies.id} and ${lobbyMembers.status} = 'attended'
  )
)`;

/**
 * A subquery `(user_id, meetups, last_met)` of the companions of `userId`; `last_met` is the end of
 * the latest shared meetup. Shadow-banned people are left out, as everywhere else.
 */
export function companionsOfSql(userId: string): SQL {
  return sql`(
    select other.user_id, count(*)::int as meetups, max(l.ends_at) as last_met
    from ${presentSql} self
    join ${presentSql} other on other.lobby_id = self.lobby_id and other.user_id <> self.user_id
    join ${lobbies} l on l.id = self.lobby_id
    join ${users} u on u.id = other.user_id
    where self.user_id = ${userId} and not u.is_shadow_banned
    group by other.user_id
  )`;
}

export async function countCompanions(db: Executor, userId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${companionsOfSql(userId)} c`,
  );
  return Number(row?.n ?? 0);
}

/** `a` and `b` were marked present at one meetup. */
export async function areCompanions(db: Executor, a: string, b: string): Promise<boolean> {
  const [row] = await db.execute<{ yes: boolean }>(
    sql`select exists (select 1 from ${companionsOfSql(a)} c where c.user_id = ${b}) as yes`,
  );
  return row?.yes === true;
}
