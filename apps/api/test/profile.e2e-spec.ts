import {
  KARMA,
  KARMA_EVENTS_LIMIT,
  RATE_LIMITS,
  karmaEventsResponse,
  type KarmaEventsResponse,
} from '@masl/shared';
import { adminUrl, addKarmaEvent, authHeader, bootApp, insertLobby, type TestApp } from './helpers.js';

describe.skipIf(!adminUrl)('profile e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
  });

  const karmaEvents = (token: string) =>
    t.app.inject({ method: 'GET', url: '/api/me/karma-events', headers: authHeader(token) });

  describe('GET /me/karma-events', () => {
    it('lists the caller’s events newest first, with the lobby title', async () => {
      const host = await t.loginOnboarded();
      const user = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Падел 2×2' });
      const base = Date.now() - 3 * 3600_000;
      await addKarmaEvent(t.db, user.user.id, 'manual', { delta: -1, at: new Date(base) });
      await addKarmaEvent(t.db, user.user.id, 'late_cancel', {
        lobbyId: lobby.id,
        at: new Date(base + 3600_000),
      });

      const response = await karmaEvents(user.token);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const body = response.json<KarmaEventsResponse>();
      expect(karmaEventsResponse.safeParse(body).success).toBe(true);
      expect(body.items).toEqual([
        {
          reason: 'late_cancel',
          delta: KARMA.LATE_CANCEL,
          createdAt: new Date(base + 3600_000).toISOString(),
          lobby: { id: lobby.id, title: 'Падел 2×2' },
        },
        { reason: 'manual', delta: -1, createdAt: new Date(base).toISOString(), lobby: null },
      ]);

      // The history and the karma on the profile agree.
      const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: authHeader(user.token) });
      expect(me.json().karma).toBe(KARMA.START - 1 + KARMA.LATE_CANCEL);
    });

    it('is empty for a new user', async () => {
      const user = await t.login();
      const response = await karmaEvents(user.token);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [] });
    });

    it(`returns at most ${KARMA_EVENTS_LIMIT} items, the latest ones`, async () => {
      const user = await t.loginOnboarded();
      const base = Date.now() - 24 * 3600_000;
      for (let i = 0; i <= KARMA_EVENTS_LIMIT; i++) {
        await addKarmaEvent(t.db, user.user.id, 'manual', { delta: 1, at: new Date(base + i * 60_000) });
      }
      const { items } = (await karmaEvents(user.token)).json<KarmaEventsResponse>();
      expect(items).toHaveLength(KARMA_EVENTS_LIMIT);
      expect(items[0]!.createdAt).toBe(new Date(base + KARMA_EVENTS_LIMIT * 60_000).toISOString());
      expect(items.at(-1)!.createdAt).toBe(new Date(base + 60_000).toISOString());
    });

    it('T-IDOR-4: user B never sees user A’s events', async () => {
      const a = await t.loginOnboarded();
      const b = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: b.user.id, title: 'Встреча Б' });
      await addKarmaEvent(t.db, a.user.id, 'late_cancel', { lobbyId: lobby.id });

      expect((await karmaEvents(b.token)).json()).toEqual({ items: [] });
      // A query parameter can't point the endpoint at someone else.
      const sneaky = await t.app.inject({
        method: 'GET',
        url: `/api/me/karma-events?userId=${a.user.id}`,
        headers: authHeader(b.token),
      });
      expect(sneaky.json()).toEqual({ items: [] });
      expect((await karmaEvents(a.token)).json<KarmaEventsResponse>().items).toHaveLength(1);
    });

    it('is rate limited per user (lobbyRead)', async () => {
      const user = await t.login();
      const other = await t.login();
      for (let i = 0; i < RATE_LIMITS.lobbyRead.limit; i++) {
        expect((await karmaEvents(user.token)).statusCode).toBe(200);
      }
      const limited = await karmaEvents(user.token);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ code: 'rate_limited' });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect((await karmaEvents(other.token)).statusCode).toBe(200);
    });
  });
});
