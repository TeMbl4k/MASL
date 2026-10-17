import { eq } from 'drizzle-orm';
import { lobbies, users } from '@masl/db';
import {
  HOSTED_UPCOMING_MAX,
  LOBBY_MAX_DAYS_AHEAD,
  NEWBIE_LOBBIES_PER_DAY,
  creationContextDto,
  lobbyDetailDto,
  type CreationContextDto,
  type LobbyDetailDto,
} from '@masl/shared';
import { nearestStation, placeHint } from '@masl/shared/metro';
import {
  CANARY_ADDRESS,
  CANARY_POINT,
  adminUrl,
  authHeader,
  bootApp,
  lobbyInput,
  setUser,
  type TestApp,
} from './helpers.js';

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
});
