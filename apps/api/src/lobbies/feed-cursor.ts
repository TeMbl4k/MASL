import { z } from 'zod';
import { LOBBY_CATEGORIES, MINUTE_MS, type LobbyCategory } from '@masl/shared';
import { apiError } from '../errors/api-error.js';

/** How long a feed snapshot (`asOf`) may be paged through; then the client reloads. */
const CURSOR_TTL_MS = 30 * MINUTE_MS;
const CURSOR_VERSION = 1;

/** PostgreSQL int4, the range rankingSql casts the karma to. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/**
 * The keyset position after the last card of a page, the frozen ranking inputs and the query it
 * belongs to. Every ranking input is frozen so the order can't shift between pages; the karma
 * and interests are the viewer's own and only order lobbies the viewer may see anyway.
 * Public values only: the score is computed from the public point.
 */
export interface FeedCursor {
  asOf: Date;
  viewerKarma: number;
  interests: LobbyCategory[];
  queryKey: string;
  locked: boolean;
  /** The score as PostgreSQL printed it (numeric, 6 decimals). */
  score: string;
  startsAt: Date;
  id: string;
}

const cursorSchema = z.strictObject({
  v: z.literal(CURSOR_VERSION),
  a: z.iso.datetime(),
  k: z.int().min(INT4_MIN).max(INT4_MAX),
  n: z.array(z.enum(LOBBY_CATEGORIES)).max(LOBBY_CATEGORIES.length),
  q: z.string().max(200),
  l: z.union([z.literal(0), z.literal(1)]),
  s: z.string().regex(/^\d{1,6}(\.\d{1,6})?$/),
  t: z.iso.datetime(),
  i: z.uuid(),
});

/** The query a cursor is bound to: the rounded origin and the filters, '' for missing values. */
export function feedQueryKey(q: { lat?: number; lng?: number; category?: string; day?: string }): string {
  return [q.lat, q.lng, q.category, q.day].map((v) => (v === undefined ? '' : String(v))).join('|');
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  const payload: z.infer<typeof cursorSchema> = {
    v: CURSOR_VERSION,
    a: cursor.asOf.toISOString(),
    k: cursor.viewerKarma,
    n: cursor.interests,
    q: cursor.queryKey,
    l: cursor.locked ? 1 : 0,
    s: cursor.score,
    t: cursor.startsAt.toISOString(),
    i: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * The cursor, or 400 `invalid_cursor` if it is garbage, of another version or query, expired
 * (asOf older than the TTL) or from the future.
 */
export function decodeFeedCursor(raw: string, expected: { queryKey: string; now: Date }): FeedCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw apiError('invalid_cursor');
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success || parsed.data.q !== expected.queryKey) throw apiError('invalid_cursor');
  const asOf = new Date(parsed.data.a);
  const age = expected.now.getTime() - asOf.getTime();
  if (age < 0 || age > CURSOR_TTL_MS) throw apiError('invalid_cursor');
  return {
    asOf,
    viewerKarma: parsed.data.k,
    interests: parsed.data.n,
    queryKey: parsed.data.q,
    locked: parsed.data.l === 1,
    score: parsed.data.s,
    startsAt: new Date(parsed.data.t),
    id: parsed.data.i,
  };
}
