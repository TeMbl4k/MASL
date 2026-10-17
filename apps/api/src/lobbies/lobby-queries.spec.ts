import { drizzle } from 'drizzle-orm/postgres-js';
import type { Database } from '@masl/db';
import {
  exactPlaceQuery,
  feedDaysQuery,
  feedPageQuery,
  hostedLobbiesQuery,
  joinedLobbiesQuery,
  lobbyForViewerQuery,
  mapLobbiesQuery,
  membersQuery,
} from './lobby-queries.js';

/** A database object that only builds SQL (no connection), configured like createDb. */
const db = drizzle.mock({ casing: 'snake_case' }) as unknown as Database;

/**
 * The exact columns, qualified or not: Drizzle leaves columns unqualified in single-table
 * queries, so the spec's `"lobbies"."location"` form alone would miss them. No other table of
 * the schema has columns named like this ("public_location" doesn't match).
 */
const EXACT_COLUMN = /"(location|address)"/;
const VIEWER = '00000000-0000-4000-8000-000000000001';
const LOBBY = '00000000-0000-4000-8000-000000000002';
const ORIGIN = { lat: 55.751, lng: 37.618 };
const NOW = new Date('2026-10-17T12:00:00.000Z');
const AS_OF = new Date('2026-10-17T11:55:00.000Z');
const CURSOR = {
  locked: true,
  score: '1.234567',
  startsAt: new Date('2026-10-18T16:00:00.000Z'),
  id: '00000000-0000-4000-8000-000000000003',
};
const DAY = '2026-10-18';
const feedPage = (cursor: typeof CURSOR | null) =>
  feedPageQuery(db, VIEWER, NOW, {
    filters: { category: 'boardgames', day: DAY },
    ranking: { asOf: AS_OF, origin: ORIGIN, interests: ['sport', 'bars'], viewerKarma: 9137 },
    cursor,
    limit: 20,
  });

/** Every public builder, by the endpoint it serves. */
const publicBuilders: Record<string, () => { toSQL(): { sql: string; params: unknown[] } }> = {
  'detail (no origin)': () => lobbyForViewerQuery(db, LOBBY, VIEWER, null),
  'detail (origin)': () => lobbyForViewerQuery(db, LOBBY, VIEWER, ORIGIN),
  'detail members': () => membersQuery(db, LOBBY),
  'feed (first page)': () => feedPage(null),
  'feed (next page)': () => feedPage(CURSOR),
  'feed days': () => feedDaysQuery(db, VIEWER, NOW, { category: 'sport', to: NOW }),
  map: () => mapLobbiesQuery(db, VIEWER, NOW, { category: 'sport', day: DAY }, 300),
  'my hosted upcoming': () => hostedLobbiesQuery(db, VIEWER, NOW, 'upcoming', 100),
  'my hosted past': () => hostedLobbiesQuery(db, VIEWER, NOW, 'past', 20),
  'my joined upcoming': () => joinedLobbiesQuery(db, VIEWER, NOW, 'upcoming', 100),
  'my joined past': () => joinedLobbiesQuery(db, VIEWER, NOW, 'past', 20),
};

describe('lobby queries (T-SQL-1)', () => {
  it.each(Object.keys(publicBuilders))('%s never reads the exact place', (name) => {
    const { sql } = publicBuilders[name]!().toSQL();
    expect(sql).not.toMatch(EXACT_COLUMN);
    // The point it does use is the public one.
    if (!['detail members', 'feed days'].includes(name)) expect(sql).toContain('"lobbies"."public_location"');
  });

  it('only loadExactPlace reads the exact columns', () => {
    expect(exactPlaceQuery(db, LOBBY).toSQL().sql).toMatch(EXACT_COLUMN);
  });

  it('passes viewer data and the origin as parameters only', () => {
    const { sql, params } = lobbyForViewerQuery(db, LOBBY, VIEWER, ORIGIN).toSQL();
    for (const value of [VIEWER, LOBBY, String(ORIGIN.lat), String(ORIGIN.lng)]) {
      expect(sql).not.toContain(value);
    }
    expect(params).toEqual(expect.arrayContaining([VIEWER, LOBBY, ORIGIN.lat, ORIGIN.lng]));
  });

  it('passes ranking, cursor and day-filter values as parameters only', () => {
    const { sql, params } = feedPage(CURSOR).toSQL();
    for (const value of [
      VIEWER,
      DAY,
      'boardgames',
      'Europe/Moscow',
      AS_OF.toISOString(),
      CURSOR.score,
      CURSOR.id,
      CURSOR.startsAt.toISOString(),
      String(ORIGIN.lat),
      '9137',
      '0.6',
      '5000',
    ]) {
      expect(sql, value).not.toContain(value);
    }
    expect(params).toEqual(
      expect.arrayContaining([
        VIEWER,
        DAY,
        'boardgames',
        'Europe/Moscow',
        AS_OF.toISOString(),
        CURSOR.score,
        CURSOR.id,
        9137,
        0.6,
        5000,
        ORIGIN.lat,
      ]),
    );
    // The distance, both in ranking and in distanceM, is from the public point.
    expect(sql.match(/ST_Distance\("lobbies"\."public_location"/g)).toHaveLength(4);
  });
});
