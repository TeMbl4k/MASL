import { eq, sql } from 'drizzle-orm';
import { geographyFrom, lobbies } from '@masl/db';
import {
  feedResponse,
  lobbyDetailDto,
  mapResponse,
  myLobbiesResponse,
  roundDistance,
  roundViewerCoord,
  type LobbyDetailDto,
} from '@masl/shared';
import { MOSCOW_STATIONS, nearestStation, placeHint, stationById } from '@masl/shared/metro';
import {
  CANARY_ADDRESS,
  CANARY_POINT,
  adminUrl,
  assertNoExactPlace,
  authHeader,
  bootApp,
  insertLobby,
  setMembership,
  setUser,
  shiftLobby,
  type TestApp,
} from './helpers.js';

/** Near «Динамо» too, on the other side of the station from the canary. */
const OTHER_SIDE = { lat: 55.786, lng: 37.566 };
/** Viewer positions: on the exact point, at «Белорусская», and one with many decimals. */
const VIEWERS = [CANARY_POINT, { lat: 55.7767, lng: 37.5821 }, { lat: 55.75123456, lng: 37.61987654 }];

const FORBIDDEN_PERSON_KEYS = ['id', 'userId', 'username', 'telegramId', 'lastName', 'gender', 'age'];

/** Fails if any person object in the body carries identifying fields beyond the public ones. */
function assertPeopleArePublic(body: Pick<LobbyDetailDto, 'host'> & { members?: LobbyDetailDto['members'] }) {
  for (const person of [body.host, ...(body.members ?? [])]) {
    expect(Object.keys(person).sort()).toEqual(['firstName', 'karma', 'photoUrl']);
    for (const key of FORBIDDEN_PERSON_KEYS) expect(person).not.toHaveProperty(key);
  }
}

describe.skipIf(!adminUrl)('lobby privacy e2e (requires TEST_DATABASE_URL)', () => {
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

  const detail = (token: string, id: string, origin?: { lat: number; lng: number }) =>
    t.app.inject({
      method: 'GET',
      url: `/api/lobbies/${id}${origin ? `?lat=${origin.lat}&lng=${origin.lng}` : ''}`,
      headers: authHeader(token),
    });

  const detailBody = async (token: string, id: string, origin?: { lat: number; lng: number }) => {
    const response = await detail(token, id, origin);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    return lobbyDetailDto.parse(response.json());
  };

  /** A host, an open lobby and one user in each membership state. */
  async function lobbyWithRoles() {
    const host = await t.loginOnboarded(undefined, 'Хост');
    const lobby = await insertLobby(t.db, { hostId: host.user.id });
    const roles = {
      outsider: await t.loginOnboarded(),
      pending: await t.loginOnboarded(),
      rejected: await t.loginOnboarded(),
      withdrawn: await t.loginOnboarded(),
      left: await t.loginOnboarded(),
      approved: await t.loginOnboarded(undefined, 'Борис'),
    };
    await setMembership(t.db, lobby.id, roles.pending.user.id, 'pending');
    await setMembership(t.db, lobby.id, roles.rejected.user.id, 'rejected');
    await setMembership(t.db, lobby.id, roles.withdrawn.user.id, 'cancelled');
    await setMembership(t.db, lobby.id, roles.left.user.id, 'cancelled', { decided: true });
    await setMembership(t.db, lobby.id, roles.approved.user.id, 'approved');
    return { host, lobby, roles };
  }

  it('T-PRIV-1: no exact place in the detail for anyone but the host and an approved member', async () => {
    const { host, lobby, roles } = await lobbyWithRoles();
    for (const role of ['outsider', 'pending', 'rejected', 'withdrawn', 'left'] as const) {
      for (const origin of [undefined, CANARY_POINT]) {
        const body = await detailBody(roles[role].token, lobby.id, origin);
        expect(body.access, role).toBe('public');
        expect(body.members, role).toBeNull();
        expect(body.approvedCount).toBe(1);
        expect(body.pendingCount).toBeNull();
        assertNoExactPlace(body, `detail for ${role}`);
        assertPeopleArePublic(body);
      }
    }
    expect((await detailBody(roles.pending.token, lobby.id)).viewer).toEqual({
      isHost: false,
      membershipStatus: 'pending',
      applyBlock: null,
    });
    expect((await detailBody(roles.left.token, lobby.id)).viewer.applyBlock).toBe('left');

    // The host and the approved member do see it, and the members.
    const member = await detailBody(roles.approved.token, lobby.id);
    expect(member).toMatchObject({
      access: 'member',
      exactPlace: { address: CANARY_ADDRESS, point: CANARY_POINT },
      members: [{ firstName: 'Борис', photoUrl: null, karma: 50 }],
      pendingCount: null,
    });
    assertPeopleArePublic(member);
    const hosted = await detailBody(host.token, lobby.id);
    expect(hosted).toMatchObject({
      access: 'host',
      exactPlace: { address: CANARY_ADDRESS },
      pendingCount: 1,
    });
    expect(hosted.members).toHaveLength(1);
  });

  it('T-PRIV-2: the member loses the exact place after finish or cancel; the host keeps it', async () => {
    const { host, lobby, roles } = await lobbyWithRoles();
    expect((await detailBody(roles.approved.token, lobby.id)).access).toBe('member');

    // Active: still visible (geo check-in happens while active).
    await shiftLobby(t.db, lobby.id, { startsInMin: -10, durationMin: 120 });
    const active = await detailBody(roles.approved.token, lobby.id);
    expect(active).toMatchObject({
      access: 'member',
      status: 'active',
      exactPlace: { address: CANARY_ADDRESS },
    });

    // Finished (without the sweeper: effective status).
    await shiftLobby(t.db, lobby.id, { startsInMin: -300, durationMin: 120 });
    const finished = await detailBody(roles.approved.token, lobby.id);
    expect(finished).toMatchObject({ access: 'public', status: 'finished' });
    expect(finished.members).toHaveLength(1);
    assertNoExactPlace(finished, 'member after finish');
    expect(await detailBody(host.token, lobby.id)).toMatchObject({
      access: 'host',
      status: 'finished',
      exactPlace: { address: CANARY_ADDRESS },
    });

    // Cancelled by the host.
    const other = await insertLobby(t.db, { hostId: host.user.id });
    await setMembership(t.db, other.id, roles.approved.user.id, 'approved');
    expect((await detailBody(roles.approved.token, other.id)).access).toBe('member');
    await t.db
      .update(lobbies)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'plans_changed' })
      .where(eq(lobbies.id, other.id));
    const cancelled = await detailBody(roles.approved.token, other.id);
    expect(cancelled).toMatchObject({ access: 'public', status: 'cancelled', cancelReason: 'plans_changed' });
    assertNoExactPlace(cancelled, 'member after host cancel');
    expect((await detailBody(host.token, other.id)).access).toBe('host');

    // Leaving an approved place.
    const third = await insertLobby(t.db, { hostId: host.user.id });
    await setMembership(t.db, third.id, roles.approved.user.id, 'approved');
    await setMembership(t.db, third.id, roles.approved.user.id, 'cancelled', { decided: true });
    const left = await detailBody(roles.approved.token, third.id);
    expect(left.access).toBe('public');
    expect(left.members).toBeNull();
    assertNoExactPlace(left, 'member after leaving');
  });

  it('T-PRIV-3: the public point is a station point and the hint names the nearest station', async () => {
    const host = await t.loginOnboarded();
    const viewer = await t.loginOnboarded();
    for (const exact of [CANARY_POINT, OTHER_SIDE, { lat: 55.7, lng: 37.4 }]) {
      const lobby = await insertLobby(t.db, { hostId: host.user.id, exact });
      const body = await detailBody(viewer.token, lobby.id);
      const { station, line } = nearestStation(exact);
      expect(
        MOSCOW_STATIONS.some((s) => s.lat === body.place.point.lat && s.lng === body.place.point.lng),
      ).toBe(true);
      expect(body.place).toMatchObject({
        hint: placeHint(station, line),
        stationId: station.id,
        point: { lat: station.lat, lng: station.lng },
      });
      expect(stationById(body.place.stationId)?.line.color).toBe(body.place.lineColor);
    }
  });

  it('T-PRIV-4: the distance is measured from the station and rounded; same station, same distance', async () => {
    const host = await t.loginOnboarded();
    const viewer = await t.loginOnboarded();
    const a = await insertLobby(t.db, { hostId: host.user.id, exact: CANARY_POINT });
    const b = await insertLobby(t.db, { hostId: host.user.id, exact: OTHER_SIDE });
    const station = nearestStation(CANARY_POINT).station;
    expect(nearestStation(OTHER_SIDE).station.id).toBe(station.id);

    for (const v of VIEWERS) {
      const rounded = { lat: roundViewerCoord(v.lat), lng: roundViewerCoord(v.lng) };
      const [row] = await t.db.execute<{ d: number }>(
        sql`select ST_Distance(${geographyFrom(station)}, ${geographyFrom(rounded)}) as d`,
      );
      const expected = roundDistance(Number(row!.d));
      const da = (await detailBody(viewer.token, a.id, v)).distanceM;
      const db = (await detailBody(viewer.token, b.id, v)).distanceM;
      expect(da).toBe(expected);
      expect(db).toBe(expected);
    }
    // Standing on the exact point gives the station distance, not zero.
    expect((await detailBody(viewer.token, a.id, CANARY_POINT)).distanceM).toBeGreaterThanOrEqual(500);
  });

  it('T-PRIV-7: a shadow-banned host’s lobby answers like a missing one, byte for byte', async () => {
    const host = await t.loginOnboarded();
    const viewer = await t.loginOnboarded();
    const member = await t.loginOnboarded();
    const rejected = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id });
    await setMembership(t.db, lobby.id, member.user.id, 'approved');
    await setMembership(t.db, lobby.id, rejected.user.id, 'rejected');
    await setUser(t.db, host.user.id, { isShadowBanned: true });

    const hidden = await detail(viewer.token, lobby.id);
    const missing = await detail(viewer.token, crypto.randomUUID());
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).toBe(missing.body);
    expect(hidden.json()).toEqual({
      statusCode: 404,
      code: 'lobby_not_found',
      message: 'Встреча не найдена',
    });
    expect((await detail(rejected.token, lobby.id)).body).toBe(missing.body);

    // The host and existing members still see it.
    expect((await detailBody(host.token, lobby.id)).access).toBe('host');
    expect((await detailBody(member.token, lobby.id)).access).toBe('member');
  });

  it('error bodies on the lobby carry no exact place', async () => {
    const { lobby, roles } = await lobbyWithRoles();
    for (const url of [
      `/api/lobbies/${lobby.id}?lat=${CANARY_POINT.lat}`,
      `/api/lobbies/${lobby.id}?lat=91&lng=37.5`,
      `/api/lobbies/${crypto.randomUUID()}?lat=${CANARY_POINT.lat}&lng=${CANARY_POINT.lng}`,
    ]) {
      const response = await t.app.inject({ method: 'GET', url, headers: authHeader(roles.outsider.token) });
      expect(response.statusCode, url).toBeGreaterThanOrEqual(400);
      assertNoExactPlace(response.json(), url);
    }
  });

  const get = async (token: string, url: string) => {
    const response = await t.app.inject({ method: 'GET', url, headers: authHeader(token) });
    expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    expect(response.headers['cache-control'], url).toBe('private, no-store');
    return response.json();
  };

  describe('lists', () => {
    beforeEach(async () => {
      await t.db.delete(lobbies);
    });

    it('T-PRIV-1/8: no exact place in the feed, map and «Мои», not even for the host', async () => {
      const { host, lobby, roles } = await lobbyWithRoles();
      const cinema = await insertLobby(t.db, { hostId: host.user.id, category: 'cinema' });
      const day = new Date(Date.now() + 24 * 3600_000);
      const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(day);
      const origins = ['', `lat=${CANARY_POINT.lat}&lng=${CANARY_POINT.lng}`, 'lat=55.7767&lng=37.5821'];
      const filters = ['', 'category=sport', 'category=cinema', `day=${dayKey}`, 'limit=1'];
      for (const role of [...Object.values(roles), host]) {
        let seen = 0;
        for (const origin of origins) {
          for (const filter of filters) {
            const url = `/api/lobbies/feed?${[origin, filter].filter(Boolean).join('&')}`;
            const body = feedResponse.parse(await get(role.token, url));
            assertNoExactPlace(body, url);
            body.items.forEach(assertPeopleArePublic);
            seen += body.items.length;
            if (body.nextCursor) {
              const next = await get(role.token, `${url}&cursor=${body.nextCursor}`);
              assertNoExactPlace(next, `${url} page 2`);
            }
          }
        }
        for (const filter of ['', 'category=sport', `day=${dayKey}`]) {
          const map = mapResponse.parse(await get(role.token, `/api/lobbies/map?${filter}`));
          assertNoExactPlace(map, `map ${filter}`);
          map.stations.forEach((s) => s.lobbies.forEach(assertPeopleArePublic));
        }
        const mine = myLobbiesResponse.parse(await get(role.token, '/api/me/lobbies'));
        assertNoExactPlace(mine, 'my lobbies');
        assertNoExactPlace(await get(role.token, '/api/lobbies/creation-context'), 'creation-context');
        // The roles that can discover the lobbies did see them, so the checks were not vacuous.
        if (role === roles.outsider || role === roles.approved) expect(seen).toBeGreaterThan(0);
      }
      const hostMine = myLobbiesResponse.parse(await get(host.token, '/api/me/lobbies'));
      expect(hostMine.hosting.upcoming.map((l) => l.id).sort()).toEqual([lobby.id, cinema.id].sort());
      const approvedMine = myLobbiesResponse.parse(await get(roles.approved.token, '/api/me/lobbies'));
      expect(approvedMine.joined.upcoming.map((l) => l.id)).toEqual([lobby.id]);
    });

    it('T-PRIV-4 (feed): distances come from the station point and match PostGIS', async () => {
      const host = await t.loginOnboarded();
      const viewer = await t.loginOnboarded();
      await insertLobby(t.db, { hostId: host.user.id, exact: CANARY_POINT });
      await insertLobby(t.db, { hostId: host.user.id, exact: OTHER_SIDE });
      const station = nearestStation(CANARY_POINT).station;
      for (const v of VIEWERS) {
        const rounded = { lat: roundViewerCoord(v.lat), lng: roundViewerCoord(v.lng) };
        const [row] = await t.db.execute<{ d: number }>(
          sql`select ST_Distance(${geographyFrom(station)}, ${geographyFrom(rounded)}) as d`,
        );
        const body = feedResponse.parse(
          await get(viewer.token, `/api/lobbies/feed?lat=${v.lat}&lng=${v.lng}`),
        );
        expect(body.items.map((i) => i.distanceM)).toEqual([
          roundDistance(Number(row!.d)),
          roundDistance(Number(row!.d)),
        ]);
      }
    });

    it('T-PRIV-5: two lobbies at one station rank the same from either exact point', async () => {
      const host = await t.loginOnboarded();
      const viewer = await t.loginOnboarded();
      const same = { hostId: host.user.id, startsInMin: 26 * 60, now: new Date() };
      const l1 = await insertLobby(t.db, { ...same, exact: CANARY_POINT });
      const l2 = await insertLobby(t.db, { ...same, exact: OTHER_SIDE });
      const [s1, s2] = await t.db
        .select({ startsAt: lobbies.startsAt })
        .from(lobbies)
        .where(sql`${lobbies.id} in (${l1.id}, ${l2.id})`);
      expect(s1!.startsAt.getTime()).toBe(s2!.startsAt.getTime());
      const byId = [l1.id, l2.id].sort();
      for (const v of [CANARY_POINT, OTHER_SIDE]) {
        const body = feedResponse.parse(
          await get(viewer.token, `/api/lobbies/feed?lat=${v.lat}&lng=${v.lng}`),
        );
        expect(body.items.map((i) => i.id)).toEqual(byId);
      }
    });
  });
});
