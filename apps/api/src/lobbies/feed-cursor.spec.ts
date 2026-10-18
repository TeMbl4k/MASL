import { HttpException } from '@nestjs/common';
import { LOBBY_CATEGORIES } from '@masl/shared';
import { decodeFeedCursor, encodeFeedCursor, feedQueryKey, type FeedCursor } from './feed-cursor.js';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const KEY = feedQueryKey({ lat: 55.751, lng: 37.618, category: 'sport' });
const CURSOR: FeedCursor = {
  asOf: new Date(NOW.getTime() - 5 * 60_000),
  viewerKarma: 35,
  interests: ['sport', 'cinema'],
  queryKey: KEY,
  locked: false,
  score: '2.351234',
  startsAt: new Date('2026-10-18T16:00:00.000Z'),
  id: '6f1c3a52-6a51-4a39-9c51-2b9f7a3c1d10',
};

const raw = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url');
const valid = () =>
  JSON.parse(Buffer.from(encodeFeedCursor(CURSOR), 'base64url').toString()) as Record<string, unknown>;

function expectInvalid(cursor: string, expected = { queryKey: KEY, now: NOW }) {
  try {
    decodeFeedCursor(cursor, expected);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toEqual({
      statusCode: 400,
      code: 'invalid_cursor',
      message: 'Список устарел — обновите ленту',
    });
    return;
  }
  throw new Error('cursor was accepted');
}

describe('feed cursor', () => {
  it('round-trips', () => {
    const encoded = encodeFeedCursor(CURSOR);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThanOrEqual(512);
    expect(decodeFeedCursor(encoded, { queryKey: KEY, now: NOW })).toEqual(CURSOR);
    // The longest realistic cursor still fits the query's 512 characters.
    const longKey = feedQueryKey({ lat: -55.751, lng: -137.618, category: 'boardgames', day: '2026-10-18' });
    const longest: FeedCursor = {
      ...CURSOR,
      queryKey: longKey,
      viewerKarma: -2_147_483_648,
      interests: [...LOBBY_CATEGORIES],
      score: '999999.999999',
    };
    const encodedLongest = encodeFeedCursor(longest);
    expect(encodedLongest.length).toBeLessThanOrEqual(512);
    expect(decodeFeedCursor(encodedLongest, { queryKey: longKey, now: NOW })).toEqual(longest);
    expect(
      decodeFeedCursor(encodeFeedCursor({ ...CURSOR, locked: true }), { queryKey: KEY, now: NOW }).locked,
    ).toBe(true);
  });

  it('binds the query: rounded origin and filters, empty for missing values', () => {
    expect(feedQueryKey({})).toBe('|||');
    expect(feedQueryKey({ lat: 55.751, lng: 37.618, category: 'sport', day: '2026-10-18' })).toBe(
      '55.751|37.618|sport|2026-10-18',
    );
    expectInvalid(encodeFeedCursor(CURSOR), {
      queryKey: feedQueryKey({ lat: 55.751, lng: 37.618 }),
      now: NOW,
    });
  });

  it('rejects garbage, another version and malformed fields', () => {
    expectInvalid('garbage!!');
    expectInvalid(Buffer.from('not json').toString('base64url'));
    expectInvalid(raw(null));
    expectInvalid(raw([]));
    expectInvalid(raw({ ...valid(), v: 2 }));
    expectInvalid(raw({ ...valid(), a: '17.10.2026' }));
    expectInvalid(raw({ ...valid(), t: 'tomorrow' }));
    expectInvalid(raw({ ...valid(), i: 'not-a-uuid' }));
    expectInvalid(raw({ ...valid(), s: '1; drop table lobbies' }));
    expectInvalid(raw({ ...valid(), l: 2 }));
    expectInvalid(raw({ ...valid(), k: 1.5 }));
    expectInvalid(raw({ ...valid(), k: 2 ** 31 }));
    expectInvalid(raw({ ...valid(), n: ['sport', 'nonsense'] }));
    expectInvalid(raw({ ...valid(), n: 'sport' }));
    expectInvalid(raw({ ...valid(), extra: 1 }));
  });

  it('rejects an expired or a future snapshot', () => {
    const at = (asOf: Date) => encodeFeedCursor({ ...CURSOR, asOf });
    expect(() =>
      decodeFeedCursor(at(new Date(NOW.getTime() - 30 * 60_000)), { queryKey: KEY, now: NOW }),
    ).not.toThrow();
    expectInvalid(at(new Date(NOW.getTime() - 30 * 60_000 - 1)));
    expectInvalid(at(new Date(NOW.getTime() + 1)));
  });
});
