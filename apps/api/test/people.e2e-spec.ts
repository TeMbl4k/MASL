import { eq } from 'drizzle-orm';
import { linkTags, userArrivals, users } from '@masl/db';
import {
  ARRIVAL_WINDOW_HOURS,
  HOUR_MS,
  apiErrorDto,
  arrivalResponse,
  companionsResponse,
  meDto,
  publicProfileDto,
  shareResponse,
  type ApiErrorCode,
} from '@masl/shared';
import {
  CANARY_ADDRESS,
  adminUrl,
  assertNoExactPlace,
  authHeader,
  bootApp,
  insertLobby,
  setMembership,
  setUser,
  type InjectResponse,
  type TestApp,
} from './helpers.js';

/** Fields a person's public data must never carry. */
const PRIVATE_KEYS = ['id', 'userId', 'username', 'telegramId', 'lastName', 'gender', 'age', 'birthYear'];

describe.skipIf(!adminUrl)('profiles, companions and sharing e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    t.telegram.reset();
  });

  const get = (token: string, url: string) =>
    t.app.inject({ method: 'GET', url, headers: authHeader(token) });
  const send = (method: 'POST' | 'PUT', token: string, url: string, payload: object) =>
    t.app.inject({ method, url, headers: authHeader(token), payload });
  const profile = (token: string, code: string) => get(token, `/api/people/${code}`);

  function expectError(response: InjectResponse, status: number, code: ApiErrorCode) {
    expect(response.statusCode, response.body).toBe(status);
    expect(apiErrorDto.parse(response.json()).code).toBe(code);
  }

  describe('public profile', () => {
    it('shows public numbers and open hosted lobbies, nothing private', async () => {
      const anna = await t.loginOnboarded(undefined, 'Анна');
      const viewer = await t.loginOnboarded(undefined, 'Борис');
      const held = await insertLobby(t.db, { hostId: anna.user.id, startsInMin: -24 * 60 });
      const empty = await insertLobby(t.db, { hostId: anna.user.id, startsInMin: -48 * 60 });
      const open = await insertLobby(t.db, { hostId: anna.user.id, title: 'Настолки' });
      const cancelled = await insertLobby(t.db, { hostId: anna.user.id, status: 'cancelled' });
      await setMembership(t.db, held.id, viewer.user.id, 'attended');
      await setMembership(t.db, empty.id, viewer.user.id, 'no_show');
      // A meetup Анна joined as a participant stays private.
      const other = await t.loginOnboarded(undefined, 'Вера');
      const joined = await insertLobby(t.db, { hostId: other.user.id, title: 'Чужая' });
      await setMembership(t.db, joined.id, anna.user.id, 'approved');

      const response = await profile(viewer.token, anna.user.publicCode);
      expect(response.statusCode, response.body).toBe(200);
      const body = publicProfileDto.parse(response.json());
      expect(body).toMatchObject({
        code: anna.user.publicCode,
        firstName: 'Анна',
        hosted: 1,
        attended: 0,
        companions: 1,
        isSelf: false,
        isCompanion: true,
      });
      expect(body.lobbies.map((l) => l.id)).toEqual([open.id]);
      expect(body.lobbies.map((l) => l.id)).not.toContain(cancelled.id);
      for (const key of PRIVATE_KEYS) expect(body).not.toHaveProperty(key);
      assertNoExactPlace(body, 'profile');
      expect(response.body).not.toContain(CANARY_ADDRESS);
    });

    it('is a 404 for an unknown, not onboarded or shadow-banned person, except to themselves', async () => {
      const viewer = await t.loginOnboarded();
      const banned = await t.loginOnboarded();
      await setUser(t.db, banned.user.id, { isShadowBanned: true });
      const fresh = await t.login();

      expectError(await profile(viewer.token, banned.user.publicCode), 404, 'person_not_found');
      expectError(await profile(viewer.token, fresh.user.publicCode), 404, 'person_not_found');
      expectError(await profile(viewer.token, '0123456789ab'), 404, 'person_not_found');
      expect((await profile(viewer.token, 'not-a-code')).statusCode).toBe(400);
      const own = publicProfileDto.parse((await profile(banned.token, banned.user.publicCode)).json());
      expect(own.isSelf).toBe(true);
    });

    it('leaves out lobbies the viewer reported', async () => {
      const host = await t.loginOnboarded();
      const viewer = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const reported = await send('POST', viewer.token, `/api/lobbies/${lobby.id}/reports`, {
        reason: 'promo',
      });
      expect(reported.statusCode, reported.body).toBe(200);
      const body = publicProfileDto.parse((await profile(viewer.token, host.user.publicCode)).json());
      expect(body.lobbies).toEqual([]);
    });
  });

  describe('companions', () => {
    it('lists people marked present together, only to their owner; applications don’t count', async () => {
      const host = await t.loginOnboarded(undefined, 'Хост');
      const [a, b, applicant] = await Promise.all([
        t.loginOnboarded(undefined, 'Аня'),
        t.loginOnboarded(undefined, 'Боря'),
        t.loginOnboarded(undefined, 'Заявка'),
      ]);
      const past = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -24 * 60 });
      await setMembership(t.db, past.id, a.user.id, 'attended');
      await setMembership(t.db, past.id, b.user.id, 'attended');
      await setMembership(t.db, past.id, applicant.user.id, 'no_show');

      const own = companionsResponse.parse((await get(a.token, '/api/me/companions')).json());
      expect(own.items.map((c) => c.person.firstName).sort()).toEqual(['Боря', 'Хост']);
      for (const item of own.items) {
        for (const key of PRIVATE_KEYS) expect(item.person).not.toHaveProperty(key);
      }
      expect(
        companionsResponse.parse((await get(applicant.token, '/api/me/companions')).json()).items,
      ).toEqual([]);
      // There is no way to ask for someone else's list.
      const sneaky = companionsResponse.parse(
        (await get(b.token, `/api/me/companions?userId=${a.user.id}`)).json(),
      );
      expect(sneaky.items.map((c) => c.person.firstName).sort()).toEqual(['Аня', 'Хост']);
      expect((await get(b.token, `/api/people/${a.user.publicCode}/companions`)).statusCode).toBe(404);
    });
  });

  describe('sharing', () => {
    it('prepares a lobby card without the exact place, with the sharer’s code in the link', async () => {
      const host = await t.loginOnboarded();
      const sharer = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Падел', slots: 4 });
      const response = await send('POST', sharer.token, '/api/share', { kind: 'lobby', id: lobby.id });
      expect(response.statusCode, response.body).toBe(200);
      const body = shareResponse.parse(response.json());
      expect(body.link).toBe(
        `https://t.me/masl_test_bot?startapp=l_${lobby.id.replaceAll('-', '')}_${sharer.user.publicCode}`,
      );
      expect(body.preparedMessageId).toMatch(/^prepared-message-/);
      const [call] = t.telegram.sent('savePreparedInlineMessage');
      expect(call!.payload.user_id).toBe(sharer.user.telegramId);
      const card = JSON.stringify(call!.payload.result);
      expect(card).toContain('Падел');
      expect(card).toContain('Свободно мест: 4 из 4');
      expect(card).not.toContain(CANARY_ADDRESS);
      assertNoExactPlace(call!.payload, 'share card');
    });

    it('refuses hidden lobbies and profiles; a failed card still gives the link', async () => {
      const host = await t.loginOnboarded();
      const sharer = await t.loginOnboarded();
      await setUser(t.db, host.user.id, { isShadowBanned: true });
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      expectError(
        await send('POST', sharer.token, '/api/share', { kind: 'lobby', id: lobby.id }),
        404,
        'lobby_not_found',
      );
      expectError(
        await send('POST', sharer.token, '/api/share', { kind: 'profile', code: host.user.publicCode }),
        404,
        'person_not_found',
      );

      t.telegram.fail('savePreparedInlineMessage', { error_code: 400, description: 'Bad Request' });
      const own = shareResponse.parse(
        (
          await send('POST', sharer.token, '/api/share', { kind: 'profile', code: sharer.user.publicCode })
        ).json(),
      );
      expect(own).toEqual({
        link: `https://t.me/masl_test_bot?startapp=p_${sharer.user.publicCode}_${sharer.user.publicCode}`,
        preparedMessageId: null,
      });
    });
  });

  describe('arrival', () => {
    const arrive = (token: string, startParam: string) =>
      send('POST', token, '/api/me/arrival', { startParam }).then((r) => arrivalResponse.parse(r.json()));
    const sourceOf = async (userId: string) =>
      (await t.db.select().from(userArrivals).where(eq(userArrivals.userId, userId)))[0] ?? null;

    it('records the first valid link of a new user: a friend or a tag, once', async () => {
      const friend = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: friend.user.id });
      const newcomer = await t.login();
      expect(
        await arrive(newcomer.token, `l_${lobby.id.replaceAll('-', '')}_${friend.user.publicCode}`),
      ).toEqual({
        recorded: true,
      });
      expect(await sourceOf(newcomer.user.id)).toMatchObject({ referrerId: friend.user.id, tagId: null });
      await t.db.insert(linkTags).values({ slug: 'channel', title: 'Канал', createdAt: new Date() });
      expect(await arrive(newcomer.token, 't_channel')).toEqual({ recorded: false });

      const second = await t.login();
      expect(await arrive(second.token, 't_channel')).toEqual({ recorded: true });
      expect(await sourceOf(second.user.id)).toMatchObject({ referrerId: null });
    });

    it('ignores old users, own codes, unknown tags and malformed links', async () => {
      const old = await t.login();
      await t.db
        .update(users)
        .set({ createdAt: new Date(Date.now() - (ARRIVAL_WINDOW_HOURS + 1) * HOUR_MS) })
        .where(eq(users.id, old.user.id));
      const friend = await t.loginOnboarded();
      expect(await arrive(old.token, `p_${friend.user.publicCode}_${friend.user.publicCode}`)).toEqual({
        recorded: false,
      });

      const fresh = await t.login();
      const code = fresh.user.publicCode;
      for (const param of [`p_${code}_${code}`, 't_nope', 'l_zzz', 'x'.repeat(64)]) {
        expect(await arrive(fresh.token, param)).toEqual({ recorded: false });
      }
      expect(await sourceOf(fresh.user.id)).toBeNull();
      expect(
        (await send('POST', fresh.token, '/api/me/arrival', { startParam: 'x'.repeat(65) })).statusCode,
      ).toBe(400);
    });
  });

  it('privacy toggles change only the caller', async () => {
    const a = await t.loginOnboarded();
    const response = await send('PUT', a.token, '/api/me/privacy', {
      hideFromSearch: true,
      invitesEnabled: false,
      userId: crypto.randomUUID(),
    });
    expect(meDto.parse(response.json())).toMatchObject({ hideFromSearch: true, invitesEnabled: false });
  });
});
