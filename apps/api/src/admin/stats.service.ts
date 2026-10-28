import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  lobbies,
  lobbyMembers,
  linkTags,
  reports,
  userActivityDays,
  userArrivals,
  users,
  type Database,
} from '@masl/db';
import {
  STATS_ALL_TIME_DAYS,
  addMoscowDays,
  moscowDayKey,
  moscowDayRange,
  type AdminStatsDto,
  type AdminStatsQuery,
  type StatsPeriod,
} from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { at } from '../lobbies/lobby-queries.js';

const PERIOD_DAYS: Record<Exclude<StatsPeriod, 'all'>, number> = { '7d': 7, '30d': 30 };

/** One number from a raw count query. */
const n = (rows: Record<string, unknown>[], key = 'n') => Number(rows[0]?.[key] ?? 0);

/**
 * The admin statistics (stage 6). Periods are whole Moscow days up to today; «Всё время»
 * counts everything and charts the last STATS_ALL_TIME_DAYS days. Only counts leave here.
 */
@Injectable()
export class StatsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async stats(query: AdminStatsQuery): Promise<AdminStatsDto> {
    const now = this.clock.now();
    const today = moscowDayKey(now);
    const days = query.period === 'all' ? STATS_ALL_TIME_DAYS : PERIOD_DAYS[query.period];
    const firstDay = addMoscowDays(today, -(days - 1));
    // «Всё время»: no lower bound for the counts.
    const from = query.period === 'all' ? new Date(0) : moscowDayRange(firstDay).start;
    const inPeriod = (column: SQL) => sql`${column} >= ${at(from)} and ${column} <= ${at(now)}`;
    const q = (query: SQL) => this.db.execute<Record<string, unknown>>(query);

    const [uniques, byDay, newUsers, created, attendance, returning, reported, sources] = await Promise.all([
      q(sql`select
        count(distinct ${userActivityDays.userId}) filter (where ${userActivityDays.day} = ${today}::date) as today,
        count(distinct ${userActivityDays.userId}) filter (where ${userActivityDays.day} >= ${addMoscowDays(today, -6)}::date) as days7,
        count(distinct ${userActivityDays.userId}) as days30
        from ${userActivityDays} where ${userActivityDays.day} >= ${addMoscowDays(today, -29)}::date`),
      q(sql`select to_char(d, 'YYYY-MM-DD') as date, count(a.user_id) as count
        from generate_series(${firstDay}::date, ${today}::date, interval '1 day') d
        left join ${userActivityDays} a on a.day = d::date
        group by d order by d`),
      q(sql`select count(*) as n, count(*) filter (where ${users.onboardedAt} is not null) as onboarded
        from ${users} where ${inPeriod(sql`${users.createdAt}`)}`),
      q(sql`select count(*) as n,
        count(*) filter (where exists (select 1 from ${lobbyMembers} m where m.lobby_id = ${lobbies}.id and m.status = 'attended')) as held,
        count(*) filter (where ${lobbies.status} = 'cancelled') as cancelled
        from ${lobbies} where ${inPeriod(sql`${lobbies.createdAt}`)}`),
      q(sql`select count(*) filter (where m.status = 'attended') as attended,
        count(*) filter (where m.status = 'no_show') as no_show
        from ${lobbyMembers} m join ${lobbies} l on l.id = m.lobby_id
        where ${inPeriod(sql`l.ends_at`)}`),
      q(sql`select count(*) as n from (
          select l.ends_at, row_number() over (partition by m.user_id order by l.ends_at, l.id) as k
          from ${lobbyMembers} m join ${lobbies} l on l.id = m.lobby_id where m.status = 'attended'
        ) x where x.k = 2 and ${inPeriod(sql`x.ends_at`)}`),
      q(sql`select count(*) as n from ${reports} where ${inPeriod(sql`${reports.createdAt}`)}`),
      q(sql`select
          case when a.referrer_id is not null then 'friends' when a.tag_id is not null then 'tag' else 'none' end as kind,
          t.slug, t.title,
          count(*) as new_users,
          count(*) filter (where u.onboarded_at is not null) as onboarded,
          count(*) filter (where exists (select 1 from ${lobbyMembers} m where m.user_id = u.id and m.status = 'attended')) as attended
        from ${users} u
        left join ${userArrivals} a on a.user_id = u.id
        left join ${linkTags} t on t.id = a.tag_id
        where ${inPeriod(sql`u.created_at`)}
        group by 1, 2, 3
        order by new_users desc, 1, 2`),
    ]);

    return {
      period: query.period,
      uniques: { today: n(uniques, 'today'), days7: n(uniques, 'days7'), days30: n(uniques, 'days30') },
      byDay: byDay.map((r) => ({ date: String(r.date), count: Number(r.count) })),
      users: { new: n(newUsers), onboarded: n(newUsers, 'onboarded') },
      lobbies: { created: n(created), held: n(created, 'held'), cancelled: n(created, 'cancelled') },
      attendance: { attended: n(attendance, 'attended'), noShow: n(attendance, 'no_show') },
      returning: n(returning),
      reports: n(reported),
      sources: sources.map((r) => ({
        kind: r.kind as AdminStatsDto['sources'][number]['kind'],
        tag: r.slug === null ? null : { slug: String(r.slug), title: String(r.title) },
        newUsers: Number(r.new_users),
        onboarded: Number(r.onboarded),
        attended: Number(r.attended),
      })),
    };
  }
}
