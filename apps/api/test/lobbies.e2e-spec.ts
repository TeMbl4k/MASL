import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { lobbies, lobbyMembers, users } from '@masl/db';
import {
  HOSTED_UPCOMING_MAX,
  LOBBY_MAX_DAYS_AHEAD,
  NEWBIE_LOBBIES_PER_DAY,
  MAP_LOBBIES_MAX,
  creationContextDto,
  feedResponse,
  cancelLobbyResponse,
  lobbyDetailDto,
  mapResponse,
  myLobbiesResponse,
  type LobbyCardDto,
  moscowDayKey,
  type CreationContextDto,
  type LobbyDetailDto,
} from '@masl/shared';
import { nearestStation, placeHint } from '@masl/shared/metro';
import {
  CANARY_ADDRESS,
  CANARY_POINT,
  adminUrl,
  assertNoExactPlace,
  authHeader,
  bootApp,
  insertLobby,
  lobbyInput,
  setMembership,
  setUser,
  shiftLobby,
  type TestApp,
} from './helpers.js';
import { LobbyStatusSweeper } from '../src/lobbies/lobby-status.sweeper.js';

const MINUTE = 60_000;
/** Inside MOSCOW_BOUNDS, more than PLACE_MAX_FROM_METRO_M from any station. */
const ZELENOGRAD = { lat: 55.9825, lng: 37.1944 };
/** Between PLACE_FAR_FROM_METRO_M and PLACE_MAX_FROM_METRO_M from «Давыдково». */
const FAR_POINT = { lat: 55.7, lng: 37.4 };

describe.skipIf(!adminUrl)('lobbies e2e (requires TEST_DATABASE_URL)', () => {
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

  const creationContext = async (token: string) => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/api/lobbies/creation-context',
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);
    return creationContextDto.parse(response.json());
  };

  describe('POST /lobbies', () => {
    it('creates a lobby: the public place is the station, the host sees the exact place', async () => {
      const host = await t.loginOnboarded(undefined, 'Анна');
      const input = lobbyInput({ minKarma: 40 });
      const response = await t.app.inject({
        method: 'POST',
        url: '/api/lobbies',
        headers: authHeader(host.token),
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const body = response.json<LobbyDetailDto>();
      expect(lobbyDetailDto.safeParse(body).success).toBe(true);
      const { station, line } = nearestStation(CANARY_POINT);
      expect(body).toMatchObject({
        access: 'host',
        category: 'sport',
        title: 'Падел 2×2',
        description: 'Ищем ещё двоих',
        startsAt: input.startsAt,
        endsAt: new Date(Date.parse(input.startsAt as string) + 120 * MINUTE).toISOString(),
        status: 'open',
        slots: 3,
        approvedCount: 0,
        pendingCount: 0,
        minKarma: 40,
        paymentFormat: 'split',
        distanceM: null,
        host: { firstName: 'Анна', photoUrl: null, karma: 50 },
        viewer: { isHost: true, membershipStatus: null, applyBlock: 'own' },
        cancelReason: null,
        cancelComment: null,
        members: [],
        place: {
          hint: 'м. Динамо',
          stationId: station.id,
          lineName: line.name,
          lineColor: line.color,
          point: { lat: station.lat, lng: station.lng },
          farFromMetro: false,
        },
        exactPlace: { address: CANARY_ADDRESS, point: CANARY_POINT },
      });
      expect(body.place.hint).toBe(placeHint(station, line));
      expect(body.place.point).not.toEqual(CANARY_POINT);

      const [row] = await t.db.select().from(lobbies).where(eq(lobbies.id, body.id));
      expect(row).toMatchObject({
        hostId: host.user.id,
        metroStationId: station.id,
        publicLocation: { lat: station.lat, lng: station.lng },
        location: CANARY_POINT,
        clientRequestId: input.requestId,
      });
    });

    it('truncates the start to the minute', async () => {
      const host = await t.loginOnboarded();
      const startsAt = new Date(Date.now() + 2 * 3600_000);
      startsAt.setUTCSeconds(42, 123);
      const response = await t.createLobby(host.token, { startsAt: startsAt.toISOString() });
      expect(response.statusCode).toBe(201);
      const truncated = new Date(startsAt);
      truncated.setUTCSeconds(0, 0);
      expect(response.json().startsAt).toBe(truncated.toISOString());
    });

    it('accepts a start with an explicit non-UTC offset', async () => {
      const host = await t.loginOnboarded();
      const start = new Date(Math.ceil((Date.now() + 5 * 3600_000) / MINUTE) * MINUTE);
      const msk = new Date(start.getTime() + 3 * 3600_000).toISOString().replace('Z', '+03:00');
      const response = await t.createLobby(host.token, { startsAt: msk });
      expect(response.statusCode).toBe(201);
      expect(response.json().startsAt).toBe(start.toISOString());
    });

    it('marks a place 1.5–5 km from the station as far from metro', async () => {
      const host = await t.loginOnboarded();
      const { station, distanceM } = nearestStation(FAR_POINT);
      expect(distanceM).toBeGreaterThan(1500);
      expect(distanceM).toBeLessThan(5000);
      const response = await t.createLobby(host.token, { location: FAR_POINT });
      expect(response.statusCode).toBe(201);
      expect(response.json().place).toMatchObject({
        stationId: station.id,
        farFromMetro: true,
        point: { lat: station.lat, lng: station.lng },
      });
    });

    it('refuses a place more than 5 km from metro or MCC (place_too_far)', async () => {
      const host = await t.loginOnboarded();
      const response = await t.createLobby(host.token, { location: ZELENOGRAD });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        statusCode: 400,
        code: 'place_too_far',
        message: 'Пока поддерживаем места не дальше 5 км от метро или МЦК',
        issues: [{ path: 'location', message: 'Пока поддерживаем места не дальше 5 км от метро или МЦК' }],
      });
      expect(await t.db.select().from(lobbies).where(eq(lobbies.hostId, host.user.id))).toEqual([]);
    });

    it('refuses a start sooner than 15 minutes or later than 30 days', async () => {
      const host = await t.loginOnboarded();
      const soon = await t.createLobby(host.token, {
        startsAt: new Date(Date.now() + 14 * MINUTE).toISOString(),
      });
      expect(soon.statusCode).toBe(400);
      expect(soon.json()).toMatchObject({
        code: 'starts_too_soon',
        message: 'Начало — не раньше чем через 15 минут',
        issues: [{ path: 'startsAt' }],
      });

      const far = await t.createLobby(host.token, {
        startsAt: new Date(Date.now() + LOBBY_MAX_DAYS_AHEAD * 24 * 3600_000 + 5 * MINUTE).toISOString(),
      });
      expect(far.statusCode).toBe(400);
      expect(far.json()).toMatchObject({ code: 'starts_too_far', issues: [{ path: 'startsAt' }] });

      const past = await t.createLobby(host.token, {
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
      });
      expect(past.json()).toMatchObject({ code: 'starts_too_soon' });
    });

    it.each([
      ['a short title', { title: 'аб' }],
      ['a long title', { title: 'а'.repeat(81) }],
      ['an empty title', { title: '' }],
      ['an unknown category', { category: 'casino' }],
      ['zero slots', { slots: 0 }],
      ['51 slots', { slots: 51 }],
      ['fractional slots', { slots: 2.5 }],
      ['min karma 101', { minKarma: 101 }],
      ['min karma −1', { minKarma: -1 }],
      ['a 29 min duration', { durationMinutes: 29 }],
      ['a 50 min duration', { durationMinutes: 50 }],
      ['a 735 min duration', { durationMinutes: 735 }],
      ['a start without an offset', { startsAt: '2026-12-01T19:00:00' }],
      ['a start that is not a date', { startsAt: 'завтра' }],
      ['a point outside Moscow', { location: { lat: 59.94, lng: 30.31 } }],
      ['an array latitude', { location: { lat: [55.78], lng: 37.55 } }],
      ['a string latitude', { location: { lat: 'NaN', lng: 37.55 } }],
      ['no location', { location: null }],
      ['a short address', { address: 'аб' }],
      ['an unknown payment format', { paymentFormat: 'cash' }],
      ['a missing requestId', { requestId: undefined }],
      ['a malformed requestId', { requestId: '..%2Fme' }],
    ])('400 for %s (T-VAL-1)', async (_name, overrides) => {
      const host = await t.loginOnboarded();
      const response = await t.createLobby(host.token, overrides);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ message: 'Некорректные данные' });
      expect(await t.db.select().from(lobbies).where(eq(lobbies.hostId, host.user.id))).toEqual([]);
    });

    it('400 for a body that is not an object', async () => {
      const host = await t.loginOnboarded();
      for (const payload of ['[]', '"x"', 'null']) {
        const response = await t.app.inject({
          method: 'POST',
          url: '/api/lobbies',
          headers: { ...authHeader(host.token), 'content-type': 'application/json' },
          payload,
        });
        expect(response.statusCode, payload).toBe(400);
      }
    });

    it('a repeated requestId returns the first lobby with 200 (T-RACE-7)', async () => {
      const host = await t.loginOnboarded();
      const requestId = crypto.randomUUID();
      const first = await t.createLobby(host.token, { requestId, title: 'Первая' });
      expect(first.statusCode).toBe(201);
      // Even with a different payload, and even though the daily limit is now reached.
      const repeat = await t.createLobby(host.token, { requestId, title: 'Вторая' });
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json()).toMatchObject({ id: first.json().id, title: 'Первая', access: 'host' });

      const parallelId = crypto.randomUUID();
      const other = await t.loginOnboarded();
      const responses = await Promise.all(
        [1, 2, 3].map(() => t.createLobby(other.token, { requestId: parallelId })),
      );
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
      expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
      expect(await t.db.select().from(lobbies).where(eq(lobbies.hostId, other.user.id))).toHaveLength(1);
    });

    it("another user's requestId creates their own lobby, never returns the first one (T-RACE-7)", async () => {
      const a = await t.loginOnboarded();
      const b = await t.loginOnboarded();
      const requestId = crypto.randomUUID();
      const first = await t.createLobby(a.token, { requestId, title: 'Лобби А' });
      expect(first.statusCode).toBe(201);

      const bPoint = { lat: 55.7601, lng: 37.6187 };
      const bAddress = 'Адрес Б, 7';
      const second = await t.createLobby(b.token, {
        requestId,
        title: 'Лобби Б',
        location: bPoint,
        address: bAddress,
      });
      expect(second.statusCode).toBe(201);
      const body = lobbyDetailDto.parse(second.json());
      expect(body.id).not.toBe(first.json().id);
      expect(body).toMatchObject({ title: 'Лобби Б', access: 'host', exactPlace: { address: bAddress } });
      assertNoExactPlace(second.json());

      const [aLobby] = await t.db.select().from(lobbies).where(eq(lobbies.hostId, a.user.id));
      expect(aLobby).toMatchObject({ id: first.json().id, title: 'Лобби А', address: CANARY_ADDRESS });
      expect(await t.db.select().from(lobbies).where(eq(lobbies.hostId, b.user.id))).toHaveLength(1);
    });

    it('T-IDOR-5: host, status, public place and karma in the body have no effect', async () => {
      const host = await t.loginOnboarded();
      const victim = await t.loginOnboarded();
      const response = await t.createLobby(host.token, {
        hostId: victim.user.id,
        userId: victim.user.id,
        status: 'cancelled',
        placeHint: 'м. Кремль',
        metroStationId: '1-ohotnyj-ryad',
        publicLocation: { ...CANARY_POINT },
        farFromMetro: true,
        karma: 100,
        approvedCount: 50,
      } as never);
      expect(response.statusCode).toBe(201);
      const body = response.json<LobbyDetailDto>();
      expect(body).toMatchObject({ status: 'open', approvedCount: 0, place: { hint: 'м. Динамо' } });
      expect(body.place.point).not.toEqual(CANARY_POINT);
      expect(body.place.farFromMetro).toBe(false);
      const [row] = await t.db.select().from(lobbies).where(eq(lobbies.id, body.id));
      expect(row).toMatchObject({ hostId: host.user.id, status: 'open', placeHint: 'м. Динамо' });
      const [victimRow] = await t.db.select().from(users).where(eq(users.id, victim.user.id));
      expect(victimRow!.karma).toBe(50);
      const [hostRow] = await t.db.select().from(users).where(eq(users.id, host.user.id));
      expect(hostRow!.karma).toBe(50);
    });

    it('T-VAL-2: SQL-looking text is stored verbatim', async () => {
      const host = await t.loginOnboarded();
      const title = "'); drop table lobbies; --";
      const response = await t.createLobby(host.token, { title, address: `${CANARY_ADDRESS} '; --` });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ title, exactPlace: { address: `${CANARY_ADDRESS} '; --` } });
      const [row] = await t.db
        .select({ title: lobbies.title })
        .from(lobbies)
        .where(eq(lobbies.id, response.json().id));
      expect(row!.title).toBe(title);
    });

    it('normalises text and keeps an empty description null', async () => {
      const host = await t.loginOnboarded();
      const response = await t.createLobby(host.token, { title: '  Падел​  2×2 ', description: '' });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ title: 'Падел 2×2', description: null });
    });

    it('401 without a token', async () => {
      const response = await t.app.inject({ method: 'POST', url: '/api/lobbies', payload: lobbyInput() });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /lobbies/creation-context', () => {
    it('mirrors the create checks for a fresh newbie and after the first lobby', async () => {
      const host = await t.loginOnboarded();
      expect(await creationContext(host.token)).toEqual<CreationContextDto>({
        canCreate: true,
        reason: null,
        retryAt: null,
        isNewbie: true,
        dailyLimit: NEWBIE_LOBBIES_PER_DAY,
        createdInWindow: 0,
        upcomingLimit: HOSTED_UPCOMING_MAX,
        upcomingCount: 0,
        addressSuggest: false,
        blockKind: null,
      });

      const created = await t.createLobby(host.token);
      expect(created.statusCode).toBe(201);
      const [row] = await t.db
        .select({ createdAt: lobbies.createdAt })
        .from(lobbies)
        .where(eq(lobbies.id, created.json().id));
      const context = await creationContext(host.token);
      expect(context).toMatchObject({
        canCreate: false,
        reason: 'daily_limit',
        retryAt: new Date(row!.createdAt.getTime() + 24 * 3600_000).toISOString(),
        createdInWindow: 1,
        upcomingCount: 1,
      });
      // And create agrees.
      expect((await t.createLobby(host.token)).statusCode).toBe(429);
    });

    it('reports not_onboarded before blocked, and blocked before the limits', async () => {
      const user = await t.login();
      expect(await creationContext(user.token)).toMatchObject({ canCreate: false, reason: 'not_onboarded' });
      expect((await t.createLobby(user.token)).json()).toMatchObject({ code: 'not_onboarded' });

      const blocked = await t.loginOnboarded();
      await setUser(t.db, blocked.user.id, { lobbyCreationBlocked: true });
      expect(await creationContext(blocked.token)).toMatchObject({ canCreate: false, reason: 'blocked' });
      expect((await t.createLobby(blocked.token)).json()).toMatchObject({ code: 'creation_blocked' });
    });

    it('401 without a token', async () => {
      const response = await t.app.inject({ method: 'GET', url: '/api/lobbies/creation-context' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /lobbies/:id', () => {
    const detail = (token: string, id: string, query = '') =>
      t.app.inject({ method: 'GET', url: `/api/lobbies/${id}${query}`, headers: authHeader(token) });

    it('shows the effective status without the sweeper (T-STATE-1)', async () => {
      const host = await t.loginOnboarded();
      const viewer = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      expect((await detail(viewer.token, lobby.id)).json()).toMatchObject({
        status: 'open',
        viewer: { applyBlock: null },
      });

      await shiftLobby(t.db, lobby.id, { startsInMin: -5, durationMin: 60 });
      expect((await detail(viewer.token, lobby.id)).json()).toMatchObject({
        status: 'active',
        viewer: { applyBlock: 'not_open' },
      });
      await shiftLobby(t.db, lobby.id, { startsInMin: -120, durationMin: 60 });
      expect((await detail(viewer.token, lobby.id)).json()).toMatchObject({ status: 'finished' });
      // The stored status is still the cache the sweeper hasn't moved.
      const [row] = await t.db
        .select({ status: lobbies.status })
        .from(lobbies)
        .where(eq(lobbies.id, lobby.id));
      expect(row!.status).toBe('open');
    });

    it('cancelled lobbies stay viewable with the reason', async () => {
      const host = await t.loginOnboarded();
      const viewer = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, status: 'cancelled' });
      await t.db.update(lobbies).set({ cancelComment: 'Заболел' }).where(eq(lobbies.id, lobby.id));
      const response = await detail(viewer.token, lobby.id);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'cancelled',
        cancelReason: 'other',
        cancelComment: 'Заболел',
        access: 'public',
        viewer: { applyBlock: 'not_open' },
      });
    });

    it('reports the viewer’s own state on the card', async () => {
      const host = await t.loginOnboarded();
      const viewer = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, minKarma: 60, slots: 1 });
      expect((await detail(viewer.token, lobby.id)).json().viewer.applyBlock).toBe('karma');
      const full = await insertLobby(t.db, { hostId: host.user.id, slots: 1 });
      const other = await t.loginOnboarded();
      await setMembership(t.db, full.id, other.user.id, 'approved');
      expect((await detail(viewer.token, full.id)).json()).toMatchObject({
        approvedCount: 1,
        viewer: { applyBlock: 'full' },
      });
      expect((await detail(other.token, full.id)).json()).toMatchObject({
        access: 'member',
        viewer: { membershipStatus: 'approved', applyBlock: null },
      });
      const notOnboarded = await t.login();
      expect((await detail(notOnboarded.token, lobby.id)).json().viewer.applyBlock).toBe('not_onboarded');
    });

    it('404 for an unknown id; 400 for a malformed id or origin (T-VAL-1)', async () => {
      const viewer = await t.loginOnboarded();
      const missing = await detail(viewer.token, crypto.randomUUID());
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({
        statusCode: 404,
        code: 'lobby_not_found',
        message: 'Встреча не найдена',
      });

      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      for (const [id, query] of [
        ['..%2Fme', ''],
        ['42', ''],
        [lobby.id, '?lat=55.75'],
        [lobby.id, '?lat=NaN&lng=37.6'],
        [lobby.id, '?lat=55.75&lng=37.6&lat=55.76'],
        [lobby.id, '?lat=59.94&lng=30.31'],
      ] as const) {
        const response = await detail(viewer.token, id, query);
        expect(response.statusCode, `${id}${query}`).toBe(400);
      }
      // Empty coordinates are a missing origin.
      expect((await detail(viewer.token, lobby.id, '?lat=&lng=')).json().distanceM).toBeNull();
    });

    it('401 without a token', async () => {
      const response = await t.app.inject({ method: 'GET', url: `/api/lobbies/${crypto.randomUUID()}` });
      expect(response.statusCode).toBe(401);
    });
  });

  const get = (token: string, url: string) =>
    t.app.inject({ method: 'GET', url, headers: authHeader(token) });
  const feedOf = async (token: string, query = '') => {
    const response = await get(token, `/api/lobbies/feed${query}`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    return feedResponse.parse(response.json());
  };
  const feedIds = async (token: string, query = '') => (await feedOf(token, query)).items.map((i) => i.id);
  const mapOf = async (token: string, query = '') => {
    const response = await get(token, `/api/lobbies/map${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return mapResponse.parse(response.json());
  };
  const mapIds = async (token: string, query = '') =>
    (await mapOf(token, query)).stations.flatMap((s) => s.lobbies.map((l) => l.id));

  /** A viewer, and one lobby for each discovery rule, by name. */
  async function discoveryFixture() {
    const viewer = await t.loginOnboarded();
    const host = await t.loginOnboarded();
    const other = await t.loginOnboarded();
    const hostId = host.user.id;
    const open = await insertLobby(t.db, { hostId, startsInMin: 3 * 60 });
    const cancelled = await insertLobby(t.db, { hostId, status: 'cancelled' });
    const started = await insertLobby(t.db, { hostId, startsInMin: -10 });
    const own = await insertLobby(t.db, { hostId: viewer.user.id });
    const full = await insertLobby(t.db, { hostId, slots: 1 });
    await setMembership(t.db, full.id, other.user.id, 'approved');
    const fullPending = await insertLobby(t.db, { hostId, slots: 1 });
    await setMembership(t.db, fullPending.id, other.user.id, 'approved');
    await setMembership(t.db, fullPending.id, viewer.user.id, 'pending');
    const fullApproved = await insertLobby(t.db, { hostId, slots: 1 });
    await setMembership(t.db, fullApproved.id, viewer.user.id, 'approved');
    const rejected = await insertLobby(t.db, { hostId });
    await setMembership(t.db, rejected.id, viewer.user.id, 'rejected');
    const left = await insertLobby(t.db, { hostId });
    await setMembership(t.db, left.id, viewer.user.id, 'cancelled', { decided: true });
    const withdrawn = await insertLobby(t.db, { hostId });
    await setMembership(t.db, withdrawn.id, viewer.user.id, 'cancelled');
    const locked = await insertLobby(t.db, { hostId, minKarma: 60, startsInMin: 60 });
    const cinema = await insertLobby(t.db, { hostId, category: 'cinema', startsInMin: 3 * 24 * 60 });
    return {
      viewer,
      host,
      shown: { open, fullPending, fullApproved, withdrawn, locked, cinema },
      hidden: { cancelled, started, own, full, rejected, left },
    };
  }

  describe('GET /lobbies/feed', () => {
    beforeEach(async () => {
      await t.db.delete(lobbies);
    });

    it('shows discoverable lobbies only, locked ones last with applyBlock karma', async () => {
      const { viewer, shown, hidden } = await discoveryFixture();
      const body = await feedOf(viewer.token);
      const ids = body.items.map((i) => i.id);
      expect([...ids].sort()).toEqual(
        Object.values(shown)
          .map((l) => l.id)
          .sort(),
      );
      for (const lobby of Object.values(hidden)) expect(ids).not.toContain(lobby.id);
      expect(ids.at(-1)).toBe(shown.locked.id);
      const byId = new Map<string, LobbyCardDto>(body.items.map((i) => [i.id, i]));
      expect(byId.get(shown.locked.id)!.viewer.applyBlock).toBe('karma');
      expect(byId.get(shown.fullPending.id)!.viewer).toEqual({
        isHost: false,
        membershipStatus: 'pending',
        applyBlock: null,
        reported: false,
      });
      expect(byId.get(shown.withdrawn.id)!.viewer).toMatchObject({
        membershipStatus: 'cancelled',
        applyBlock: null,
      });
      expect(byId.get(shown.open.id)!.distanceM).toBeNull();
      expect(body.nextCursor).toBeNull();
    });

    it('filters by category and day; day counts come on the first page only', async () => {
      const { viewer, shown } = await discoveryFixture();
      expect(await feedIds(viewer.token, '?category=cinema')).toEqual([shown.cinema.id]);
      const day = new Date(Date.now() + 3 * 24 * 3600_000);
      const dayKey = moscowDayKey(day);
      expect(await feedIds(viewer.token, `?day=${dayKey}`)).toContain(shown.cinema.id);
      expect(await feedIds(viewer.token, `?day=${dayKey}&category=sport`)).not.toContain(shown.cinema.id);

      const first = await feedOf(viewer.token, '?limit=2');
      expect(first.items).toHaveLength(2);
      expect(first.days).toHaveLength(7);
      expect(first.days!.reduce((n, d) => n + d.count, 0)).toBe(Object.keys(shown).length);
      expect(first.nextCursor).not.toBeNull();
      const second = await feedOf(viewer.token, `?limit=2&cursor=${first.nextCursor}`);
      expect(second.days).toBeNull();
      expect(second.items.map((i) => i.id)).not.toContain(first.items[0]!.id);
    });

    it('400 for a tampered cursor or malformed query (T-VAL-1)', async () => {
      const { viewer } = await discoveryFixture();
      const first = await feedOf(viewer.token, '?limit=2');
      const tampered = Buffer.from(
        JSON.stringify({ ...JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString()), s: '99' }),
      ).toString('base64url');
      for (const query of [
        `?limit=2&cursor=${tampered}x`,
        `?limit=2&cursor=garbage`,
        `?limit=2&category=cinema&cursor=${first.nextCursor}`,
      ]) {
        const response = await get(viewer.token, `/api/lobbies/feed${query}`);
        expect(response.statusCode, query).toBe(400);
        expect(response.json()).toEqual({
          statusCode: 400,
          code: 'invalid_cursor',
          message: 'Список устарел — обновите ленту',
        });
      }
      for (const query of [
        '?limit=1000',
        '?limit=0',
        '?limit=abc',
        '?lat=55.75',
        '?lat=NaN&lng=37.6',
        '?lat=55.75&lng=200',
        '?category=casino',
        '?day=2026-02-30',
        `?cursor=${'a'.repeat(600)}`,
      ]) {
        expect((await get(viewer.token, `/api/lobbies/feed${query}`)).statusCode, query).toBe(400);
      }
      // Empty parameters are missing ones.
      expect(
        (await get(viewer.token, '/api/lobbies/feed?lat=&lng=&limit=&category=&day=&cursor=')).statusCode,
      ).toBe(200);
    });
  });

  describe('GET /lobbies/map', () => {
    beforeEach(async () => {
      await t.db.delete(lobbies);
    });

    it('groups discoverable lobbies by station, earliest first, without distances', async () => {
      const { viewer, shown, hidden } = await discoveryFixture();
      const teply = await insertLobby(t.db, {
        hostId: (await t.loginOnboarded()).user.id,
        exact: { lat: 55.6195, lng: 37.5085 },
        startsInMin: 30,
      });
      const body = await mapOf(viewer.token);
      expect(body.truncated).toBe(false);
      expect(body.stations).toHaveLength(2);
      const [first, second] = body.stations;
      expect(first!.place.stationId).toBe(nearestStation({ lat: 55.6195, lng: 37.5085 }).station.id);
      expect(first!.lobbies.map((l) => l.id)).toEqual([teply.id]);
      expect(second!.place).toMatchObject({ stationId: '2-dinamo', hint: 'м. Динамо' });
      const ids = second!.lobbies.map((l) => l.id);
      expect([...ids].sort()).toEqual(
        Object.values(shown)
          .map((l) => l.id)
          .sort(),
      );
      const starts = second!.lobbies.map((l) => l.startsAt);
      expect(starts).toEqual([...starts].sort());
      for (const lobby of Object.values(hidden)) expect(ids).not.toContain(lobby.id);
      for (const station of body.stations) {
        for (const lobby of station.lobbies) {
          expect(lobby.distanceM).toBeNull();
          expect(lobby.place).toEqual(station.place);
        }
      }
      expect(await mapIds(viewer.token, '?category=cinema')).toEqual([shown.cinema.id]);
    });

    it(`is truncated above ${MAP_LOBBIES_MAX} lobbies, keeping the earliest`, async () => {
      const viewer = await t.loginOnboarded();
      const host = await t.loginOnboarded();
      for (let i = 0; i <= MAP_LOBBIES_MAX; i++) {
        await insertLobby(t.db, { hostId: host.user.id, startsInMin: 60 + i });
      }
      const body = await mapOf(viewer.token);
      expect(body.truncated).toBe(true);
      const lobbiesShown = body.stations.flatMap((s) => s.lobbies);
      expect(lobbiesShown).toHaveLength(MAP_LOBBIES_MAX);
      const latest = Math.max(...lobbiesShown.map((l) => Date.parse(l.startsAt)));
      const [row] = await t.db
        .select({ startsAt: lobbies.startsAt })
        .from(lobbies)
        .orderBy(desc(lobbies.startsAt))
        .limit(1);
      expect(latest).toBeLessThan(row!.startsAt.getTime());
    });

    it('400 for a malformed query', async () => {
      const viewer = await t.loginOnboarded();
      for (const query of ['?category=casino', '?day=tomorrow']) {
        expect((await get(viewer.token, `/api/lobbies/map${query}`)).statusCode, query).toBe(400);
      }
    });
  });

  describe('GET /me/lobbies', () => {
    const mine = async (token: string) => {
      const response = await get(token, '/api/me/lobbies');
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      return myLobbiesResponse.parse(response.json());
    };
    const idsOf = (cards: LobbyCardDto[]) => cards.map((c) => c.id);

    it('splits hosted lobbies into upcoming and past/cancelled', async () => {
      const host = await t.loginOnboarded();
      const hostId = host.user.id;
      const later = await insertLobby(t.db, { hostId, startsInMin: 48 * 60 });
      const soon = await insertLobby(t.db, { hostId, startsInMin: 60 });
      const active = await insertLobby(t.db, { hostId, startsInMin: -10 });
      const finished = await insertLobby(t.db, { hostId, startsInMin: -300 });
      const cancelled = await insertLobby(t.db, { hostId, status: 'cancelled', startsInMin: 120 });
      const member = await t.loginOnboarded();
      await setMembership(t.db, soon.id, member.user.id, 'approved');
      const applicant = await t.loginOnboarded();
      await setMembership(t.db, soon.id, applicant.user.id, 'pending');

      const body = await mine(host.token);
      expect(idsOf(body.hosting.upcoming)).toEqual([active.id, soon.id, later.id]);
      expect(idsOf(body.hosting.past)).toEqual([cancelled.id, finished.id]);
      expect(body.joined).toEqual({ upcoming: [], past: [] });
      expect(body.counts).toEqual({ hosted: 4, joined: 0, companions: 0 });
      expect(body.hosting.upcoming[1]).toMatchObject({
        approvedCount: 1,
        pendingCount: 1,
        viewer: { isHost: true },
      });
      expect(body.hosting.upcoming.map((c) => c.status)).toEqual(['active', 'open', 'open']);
    });

    it('splits joined lobbies; rejected and left are past, a withdrawn application is absent', async () => {
      const viewer = await t.loginOnboarded();
      const hostId = (await t.loginOnboarded()).user.id;
      const pending = await insertLobby(t.db, { hostId, startsInMin: 120 });
      const approved = await insertLobby(t.db, { hostId, startsInMin: 60 });
      const approvedActive = await insertLobby(t.db, { hostId, startsInMin: -10 });
      const rejected = await insertLobby(t.db, { hostId, startsInMin: 180 });
      const left = await insertLobby(t.db, { hostId, startsInMin: 240 });
      const withdrawn = await insertLobby(t.db, { hostId, startsInMin: 300 });
      const approvedFinished = await insertLobby(t.db, { hostId, startsInMin: -600 });
      const pendingCancelled = await insertLobby(t.db, { hostId, status: 'cancelled', startsInMin: 90 });
      const attended = await insertLobby(t.db, { hostId, startsInMin: -900 });
      const unrelated = await insertLobby(t.db, { hostId, startsInMin: 30 });
      await setMembership(t.db, pending.id, viewer.user.id, 'pending');
      await setMembership(t.db, approved.id, viewer.user.id, 'approved');
      await setMembership(t.db, approvedActive.id, viewer.user.id, 'approved');
      await setMembership(t.db, rejected.id, viewer.user.id, 'rejected');
      await setMembership(t.db, left.id, viewer.user.id, 'cancelled', { decided: true });
      await setMembership(t.db, withdrawn.id, viewer.user.id, 'cancelled');
      await setMembership(t.db, approvedFinished.id, viewer.user.id, 'approved');
      await setMembership(t.db, pendingCancelled.id, viewer.user.id, 'pending');
      await setMembership(t.db, attended.id, viewer.user.id, 'attended');

      const body = await mine(viewer.token);
      expect(idsOf(body.joined.upcoming)).toEqual([approvedActive.id, approved.id, pending.id]);
      expect(idsOf(body.joined.past)).toEqual([
        left.id,
        rejected.id,
        pendingCancelled.id,
        approvedFinished.id,
        attended.id,
      ]);
      const all = [...idsOf(body.joined.upcoming), ...idsOf(body.joined.past)];
      expect(all).not.toContain(withdrawn.id);
      expect(all).not.toContain(unrelated.id);
      expect(body.hosting).toEqual({ upcoming: [], past: [] });
      // The host of the attended meetup is the one companion.
      expect(body.counts).toEqual({ hosted: 0, joined: 4, companions: 1 });
      expect(body.joined.past[0]!.viewer).toMatchObject({
        membershipStatus: 'cancelled',
        applyBlock: 'left',
      });
    });

    it('T-IDOR-4: user B never sees user A’s lobbies in «Мои»', async () => {
      const a = await t.loginOnboarded();
      const b = await t.loginOnboarded();
      const hosted = await insertLobby(t.db, { hostId: a.user.id });
      const joined = await insertLobby(t.db, { hostId: (await t.loginOnboarded()).user.id });
      await setMembership(t.db, joined.id, a.user.id, 'approved');
      const sneaky = await get(b.token, `/api/me/lobbies?userId=${a.user.id}`);
      expect(sneaky.json()).toEqual({
        hosting: { upcoming: [], past: [] },
        joined: { upcoming: [], past: [] },
        counts: { hosted: 0, joined: 0, companions: 0 },
        attendanceDue: [],
      });
      const own = await mine(a.token);
      expect(idsOf(own.hosting.upcoming)).toEqual([hosted.id]);
      expect(idsOf(own.joined.upcoming)).toEqual([joined.id]);
    });

    it('401 without a token', async () => {
      expect((await t.app.inject({ method: 'GET', url: '/api/me/lobbies' })).statusCode).toBe(401);
    });
  });

  describe('POST /lobbies/:id/cancel', () => {
    const cancel = (
      token: string,
      id: string,
      payload: object = { reason: 'plans_changed', comment: 'Заболел' },
    ) =>
      t.app.inject({ method: 'POST', url: `/api/lobbies/${id}/cancel`, headers: authHeader(token), payload });
    const membersOf = (lobbyId: string) =>
      t.db
        .select({
          userId: lobbyMembers.userId,
          status: lobbyMembers.status,
          updatedAt: lobbyMembers.updatedAt,
        })
        .from(lobbyMembers)
        .where(eq(lobbyMembers.lobbyId, lobbyId))
        .orderBy(lobbyMembers.userId);
    const karmaOf = async (userId: string) =>
      (await t.db.select({ karma: users.karma }).from(users).where(eq(users.id, userId)))[0]!.karma;

    it('cancels before the start: members see the reason, memberships and karma stay', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const viewer = await t.loginOnboarded();
      // Within an hour of the start, but not every slot is taken: no penalty.
      const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 40, category: 'music' });
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      await setMembership(t.db, lobby.id, applicant.user.id, 'pending');
      const before = await membersOf(lobby.id);
      expect(await feedIds(viewer.token, '?category=music')).toEqual([lobby.id]);

      const response = await cancel(host.token, lobby.id);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const { lobby: body, karmaDelta } = cancelLobbyResponse.parse(response.json());
      expect(karmaDelta).toBe(0);
      expect(body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'plans_changed',
        cancelComment: 'Заболел',
        access: 'host',
        exactPlace: { address: CANARY_ADDRESS },
      });
      const [row] = await t.db.select().from(lobbies).where(eq(lobbies.id, lobby.id));
      expect(row).toMatchObject({
        status: 'cancelled',
        cancelReason: 'plans_changed',
        cancelComment: 'Заболел',
      });
      expect(row!.cancelledAt).not.toBeNull();

      for (const who of [member, applicant]) {
        const seen = await t.app.inject({
          method: 'GET',
          url: `/api/lobbies/${lobby.id}`,
          headers: authHeader(who.token),
        });
        expect(seen.json()).toMatchObject({
          status: 'cancelled',
          cancelReason: 'plans_changed',
          cancelComment: 'Заболел',
          access: 'public',
        });
        assertNoExactPlace(seen.json(), 'member after host cancel');
      }
      expect(await feedIds(viewer.token, '?category=music')).toEqual([]);
      expect(await membersOf(lobby.id)).toEqual(before);
      for (const who of [host, member, applicant]) expect(await karmaOf(who.user.id)).toBe(50);

      // A repeat is idempotent and keeps the first reason.
      const repeat = await cancel(host.token, lobby.id, { reason: 'other' });
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json()).toMatchObject({
        lobby: { status: 'cancelled', cancelReason: 'plans_changed' },
        karmaDelta: 0,
      });
    });

    it('the comment is optional; 400 for an unknown reason or a long comment', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      for (const payload of [{}, { reason: 'bored' }, { reason: 'other', comment: 'а'.repeat(201) }, []]) {
        expect((await cancel(host.token, lobby.id, payload)).statusCode, JSON.stringify(payload)).toBe(400);
      }
      const response = await cancel(host.token, lobby.id, { reason: 'not_enough_people', comment: '  ' });
      expect(response.json()).toMatchObject({
        lobby: { cancelReason: 'not_enough_people', cancelComment: null },
      });
    });

    it('409 after the start; 403 for a non-host; 404 for a hidden or missing lobby (T-IDOR-3)', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const outsider = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, member.user.id, 'approved');

      for (const who of [member, outsider]) {
        const refused = await cancel(who.token, lobby.id);
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toEqual({
          statusCode: 403,
          code: 'not_host',
          message: 'Управлять встречей может только хост',
        });
        assertNoExactPlace(refused.json(), 'not_host');
      }
      const missing = await cancel(host.token, crypto.randomUUID());
      expect(missing.statusCode).toBe(404);
      expect((await cancel(host.token, '..%2Fme')).statusCode).toBe(400);

      await setUser(t.db, host.user.id, { isShadowBanned: true });
      const hidden = await cancel(outsider.token, lobby.id);
      expect(hidden.statusCode).toBe(404);
      expect(hidden.body).toBe(missing.body);
      expect((await cancel(member.token, lobby.id)).statusCode).toBe(403);
      await setUser(t.db, host.user.id, { isShadowBanned: false });

      const [row] = await t.db
        .select({ status: lobbies.status })
        .from(lobbies)
        .where(eq(lobbies.id, lobby.id));
      expect(row!.status).toBe('open');

      await shiftLobby(t.db, lobby.id, { startsInMin: -1 });
      const started = await cancel(host.token, lobby.id);
      expect(started.statusCode).toBe(409);
      expect(started.json()).toEqual({
        statusCode: 409,
        code: 'lobby_started',
        message: 'Встреча уже началась',
      });
      await shiftLobby(t.db, lobby.id, { startsInMin: -300 });
      expect((await cancel(host.token, lobby.id)).json()).toMatchObject({ code: 'lobby_started' });
    });
  });

  describe('lobby status sweeper', () => {
    beforeEach(async () => {
      await t.db.delete(lobbies);
    });

    const statusOf = async (id: string) =>
      (await t.db.select({ status: lobbies.status }).from(lobbies).where(eq(lobbies.id, id)))[0]!.status;

    it('persists started and finished lobbies once; cancelled ones stay cancelled (T-STATE-3)', async () => {
      const hostId = (await t.loginOnboarded()).user.id;
      const upcoming = await insertLobby(t.db, { hostId, startsInMin: 30 });
      const started = await insertLobby(t.db, { hostId, startsInMin: -10, durationMin: 60 });
      const overdue = await insertLobby(t.db, { hostId, startsInMin: -300, durationMin: 60 });
      const activeDone = await insertLobby(t.db, {
        hostId,
        startsInMin: -300,
        durationMin: 60,
        status: 'active',
      });
      const cancelled = await insertLobby(t.db, { hostId, startsInMin: -300, status: 'cancelled' });

      const sweeper = t.app.get(LobbyStatusSweeper);
      const result = await sweeper.sweep();
      expect(result.started).toEqual([started.id]);
      expect([...result.finished].sort()).toEqual([overdue.id, activeDone.id].sort());
      expect(await statusOf(upcoming.id)).toBe('open');
      expect(await statusOf(started.id)).toBe('active');
      expect(await statusOf(overdue.id)).toBe('finished');
      expect(await statusOf(cancelled.id)).toBe('cancelled');

      expect(await sweeper.sweep()).toEqual({ started: [], finished: [] });

      await shiftLobby(t.db, started.id, { startsInMin: -120, durationMin: 60 });
      expect(await sweeper.sweep()).toEqual({ started: [], finished: [started.id] });
    });

    it('concurrent sweeps return each id once', async () => {
      const hostId = (await t.loginOnboarded()).user.id;
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await insertLobby(t.db, { hostId, startsInMin: -10 - i })).id);
      const sweeper = t.app.get(LobbyStatusSweeper);
      const results = await Promise.all([1, 2, 3].map(() => sweeper.sweep()));
      const started = results.flatMap((r) => r.started);
      expect(started.sort()).toEqual([...ids].sort());
      expect(results.flatMap((r) => r.finished)).toEqual([]);
    });

    it('a sweep racing a host cancel leaves a consistent row', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 60 });
      const sweeper = t.app.get(LobbyStatusSweeper);
      const [response] = await Promise.all([
        t.app.inject({
          method: 'POST',
          url: `/api/lobbies/${lobby.id}/cancel`,
          headers: authHeader(host.token),
          payload: { reason: 'other' },
        }),
        sweeper.sweep(),
      ]);
      expect(response.statusCode).toBe(200);
      expect(await statusOf(lobby.id)).toBe('cancelled');
      await shiftLobby(t.db, lobby.id, { startsInMin: -300, durationMin: 60 });
      expect(await sweeper.sweep()).toEqual({ started: [], finished: [] });
      expect(await statusOf(lobby.id)).toBe('cancelled');
    });

    it('a failed scheduled run logs only the redacted shape and does not throw', async () => {
      const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      await t.db.execute(sql`alter table lobbies rename to lobbies_x`);
      try {
        await expect(t.app.get(LobbyStatusSweeper).tick()).resolves.toBeUndefined();
      } finally {
        await t.db.execute(sql`alter table lobbies_x rename to lobbies`);
      }
      const calls = [...log.mock.calls];
      log.mockRestore();
      expect(calls).toHaveLength(1);
      const logged = inspect(calls, { depth: 10 });
      expect(logged).toContain('pgCode=42P01');
      expect(logged).not.toContain('update');
      expect(logged).not.toContain('lobbies_x');
    });
  });
});
