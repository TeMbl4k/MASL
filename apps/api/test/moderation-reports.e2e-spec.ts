import { and, eq, sql } from 'drizzle-orm';
import { moderationActions, moderationCases, notifications, reports, users } from '@masl/db';
import {
  REPORTS_PER_DAY_MAX,
  feedResponse,
  lobbyDetailDto,
  mapResponse,
  myLobbiesResponse,
  type AuthResponse,
} from '@masl/shared';
import {
  adminUrl,
  authHeader,
  bootApp,
  insertLobby,
  setMembership,
  setUser,
  type TestApp,
} from './helpers.js';

describe.skipIf(!adminUrl)(
  'lobby reports and the automatic shadow ban e2e (requires TEST_DATABASE_URL)',
  () => {
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

    const report = (token: string, lobbyId: string, payload: object = { reason: 'scam' }) =>
      t.app.inject({
        method: 'POST',
        url: `/api/lobbies/${lobbyId}/reports`,
        headers: authHeader(token),
        payload,
      });
    const get = (token: string, url: string) =>
      t.app.inject({ method: 'GET', url, headers: authHeader(token) });
    /** An onboarded user whose account is two days old, so their reports count. */
    const reporter = async (): Promise<AuthResponse> => {
      const auth = await t.loginOnboarded();
      await t.db
        .update(users)
        .set({ createdAt: sql`now() - interval '2 days'` })
        .where(eq(users.id, auth.user.id));
      return auth;
    };
    const userRow = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0]!;
    const caseOf = async (subjectId: string) =>
      (
        await t.db
          .select()
          .from(moderationCases)
          .where(and(eq(moderationCases.subjectId, subjectId), eq(moderationCases.kind, 'reports')))
      )[0];
    const visibleIds = async (token: string) => {
      const feed = feedResponse.parse((await get(token, '/api/lobbies/feed')).json());
      const map = mapResponse.parse((await get(token, '/api/lobbies/map')).json());
      const mine = myLobbiesResponse.parse((await get(token, '/api/me/lobbies')).json());
      return {
        feed: feed.items.map((c) => c.id),
        map: map.stations.flatMap((s) => s.lobbies.map((c) => c.id)),
        joined: mine.joined.upcoming.map((c) => c.id),
      };
    };

    it('hides the reported lobby from the reporter only; a repeat changes nothing', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const viewer = await reporter();
      const other = await t.loginOnboarded();

      const first = await report(viewer.token, lobby.id, {
        reason: 'scam',
        comment: 'Просит перевести 500 ₽',
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toEqual({ reported: true });
      const repeat = await report(viewer.token, lobby.id, { reason: 'promo' });
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json()).toEqual({ reported: true });
      const rows = await t.db.select().from(reports).where(eq(reports.lobbyId, lobby.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        reason: 'scam',
        comment: 'Просит перевести 500 ₽',
        subjectId: host.user.id,
        notCounted: null,
      });

      const hidden = await get(viewer.token, `/api/lobbies/${lobby.id}`);
      const missing = await get(viewer.token, `/api/lobbies/${crypto.randomUUID()}`);
      expect(hidden.statusCode).toBe(404);
      expect(hidden.body).toBe(missing.body);
      const seen = await visibleIds(viewer.token);
      expect(seen.feed).not.toContain(lobby.id);
      expect(seen.map).not.toContain(lobby.id);

      // Everyone else, the host included, sees it as before, and nobody is told.
      expect((await visibleIds(other.token)).feed).toContain(lobby.id);
      expect(lobbyDetailDto.parse((await get(host.token, `/api/lobbies/${lobby.id}`)).json()).access).toBe(
        'host',
      );
      expect(await t.db.select().from(notifications).where(eq(notifications.lobbyId, lobby.id))).toEqual([]);
      expect((await userRow(host.user.id)).isShadowBanned).toBe(false);
    });

    it('keeps the lobby for a pending or approved reporter, marked as reported', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const member = await reporter();
      await setMembership(t.db, lobby.id, member.user.id, 'pending');
      expect((await report(member.token, lobby.id)).statusCode).toBe(200);

      const detail = lobbyDetailDto.parse((await get(member.token, `/api/lobbies/${lobby.id}`)).json());
      expect(detail.viewer).toMatchObject({ membershipStatus: 'pending', reported: true });
      const seen = await visibleIds(member.token);
      expect(seen.feed).toContain(lobby.id);
      expect(seen.joined).toContain(lobby.id);
      const outsider = await t.loginOnboarded();
      const card = feedResponse
        .parse((await get(outsider.token, '/api/lobbies/feed')).json())
        .items.find((c) => c.id === lobby.id);
      expect(card?.viewer.reported).toBe(false);
    });

    it('refuses the host, a hidden lobby like a missing one, and users without a profile', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const own = await report(host.token, lobby.id);
      expect(own.statusCode).toBe(400);
      expect(own.json()).toEqual({
        statusCode: 400,
        code: 'report_own_lobby',
        message: 'На свою встречу пожаловаться нельзя',
      });

      const bannedHost = await t.loginOnboarded();
      const hiddenLobby = await insertLobby(t.db, { hostId: bannedHost.user.id });
      await setUser(t.db, bannedHost.user.id, { isShadowBanned: true });
      const viewer = await reporter();
      const hidden = await report(viewer.token, hiddenLobby.id);
      const missing = await report(viewer.token, crypto.randomUUID());
      expect(hidden.statusCode).toBe(404);
      expect(hidden.body).toBe(missing.body);
      expect(await t.db.select().from(reports).where(eq(reports.lobbyId, hiddenLobby.id))).toEqual([]);

      const fresh = await t.login();
      const notOnboarded = await report(fresh.token, lobby.id);
      expect(notOnboarded.statusCode).toBe(403);
      expect(notOnboarded.json()).toMatchObject({ code: 'not_onboarded' });

      const bad = await report(viewer.token, lobby.id, { reason: 'spam' });
      expect(bad.statusCode).toBe(400);
    });

    it(`caps reports at ${REPORTS_PER_DAY_MAX} a day per reporter`, async () => {
      const host = await t.loginOnboarded();
      const viewer = await reporter();
      for (let i = 0; i < REPORTS_PER_DAY_MAX; i++) {
        const lobby = await insertLobby(t.db, { hostId: host.user.id });
        expect((await report(viewer.token, lobby.id)).statusCode).toBe(200);
      }
      t.resetRateLimits();
      const extra = await insertLobby(t.db, { hostId: host.user.id });
      const capped = await report(viewer.token, extra.id);
      expect(capped.statusCode).toBe(429);
      expect(capped.json()).toMatchObject({ code: 'reports_daily_limit' });
    });

    it('shadow-bans the host at the third independent reporter, once, with a log entry', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Бизнес-завтрак' });
      const second = await insertLobby(t.db, { hostId: host.user.id });
      const [a, b, c] = [await reporter(), await reporter(), await reporter()];
      const newcomer = await t.loginOnboarded();
      const banned = await reporter();
      await setUser(t.db, banned.user.id, { isShadowBanned: true });

      // Reports that don't count: a fresh account, a banned reporter, the same person twice.
      await report(newcomer.token, lobby.id);
      await report(banned.token, lobby.id);
      await report(a.token, lobby.id);
      await report(a.token, second.id);
      await report(b.token, lobby.id);
      expect((await userRow(host.user.id)).isShadowBanned).toBe(false);
      const counted = await t.db
        .select({ reporterId: reports.reporterId, notCounted: reports.notCounted })
        .from(reports)
        .where(eq(reports.subjectId, host.user.id));
      const others = counted.filter((r) => r.reporterId !== a.user.id);
      expect(new Map(others.map((r) => [r.reporterId, r.notCounted]))).toEqual(
        new Map([
          [newcomer.user.id, 'new_account'],
          [banned.user.id, 'shadow_banned'],
          [b.user.id, null],
        ]),
      );
      expect(
        counted
          .filter((r) => r.reporterId === a.user.id)
          .map((r) => r.notCounted)
          .sort(),
      ).toEqual([null, 'same_reporter']);

      await report(c.token, second.id);
      expect((await userRow(host.user.id)).isShadowBanned).toBe(true);
      const kase = (await caseOf(host.user.id))!;
      expect(kase.shadowBannedAt).toBeInstanceOf(Date);
      expect(kase.resolvedAt).toBeNull();
      const log = await t.db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.subjectId, host.user.id));
      expect(log).toEqual([
        expect.objectContaining({ action: 'auto_shadow_ban', actorId: null, caseId: kase.id }),
      ]);

      // Banned: an outsider no longer sees the lobby; a fourth report joins the same case only.
      const outsider = await t.loginOnboarded();
      expect((await get(outsider.token, `/api/lobbies/${lobby.id}`)).statusCode).toBe(404);
      const d = await reporter();
      await setMembership(t.db, lobby.id, d.user.id, 'approved');
      expect((await report(d.token, lobby.id)).statusCode).toBe(200);
      const cases = await t.db
        .select()
        .from(moderationCases)
        .where(eq(moderationCases.subjectId, host.user.id));
      expect(cases).toHaveLength(1);
      expect(
        await t.db.select().from(moderationActions).where(eq(moderationActions.subjectId, host.user.id)),
      ).toHaveLength(1);
    });
  },
);
