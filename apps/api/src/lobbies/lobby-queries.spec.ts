import { drizzle } from 'drizzle-orm/postgres-js';
import type { Database } from '@masl/db';
import { exactPlaceQuery, lobbyForViewerQuery, membersQuery } from './lobby-queries.js';

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

/** Every public builder, by the endpoint it serves. */
const publicBuilders: Record<string, () => { toSQL(): { sql: string; params: unknown[] } }> = {
  'detail (no origin)': () => lobbyForViewerQuery(db, LOBBY, VIEWER, null),
  'detail (origin)': () => lobbyForViewerQuery(db, LOBBY, VIEWER, ORIGIN),
  'detail members': () => membersQuery(db, LOBBY),
};

describe('lobby queries (T-SQL-1)', () => {
  it.each(Object.keys(publicBuilders))('%s never reads the exact place', (name) => {
    const { sql } = publicBuilders[name]!().toSQL();
    expect(sql).not.toMatch(EXACT_COLUMN);
    // The point it does use is the public one.
    if (name.startsWith('detail (')) expect(sql).toContain('"lobbies"."public_location"');
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
});
