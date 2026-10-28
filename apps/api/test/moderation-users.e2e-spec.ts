import { eq } from 'drizzle-orm';
import { moderationCases, users } from '@masl/db';
import {
  KARMA,
  MODERATION_KARMA_DELTA_MAX,
  adminUserCardDto,
  adminUserSearchResponse,
  karmaEventsResponse,
  type AuthResponse,
} from '@masl/shared';
import { prefixPattern } from '../src/lobbies/lobby-queries.js';
import {
  adminUrl,
  authHeader,
  bootApp,
  freshTelegramId,
  insertUser,
  setUser,
  type TestApp,
} from './helpers.js';

describe('prefixPattern', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(prefixPattern('ан')).toBe('ан%');
    expect(prefixPattern('50%_off\\')).toBe('50\\%\\_off\\\\%');
  });
});

describe.skipIf(!adminUrl)('moderator user card and actions e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  const adminTelegramId = freshTelegramId();

  beforeAll(async () => {
    t = await bootApp({ env: { ADMIN_TELEGRAM_IDS: String(adminTelegramId) } });
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
  });

  const get = (token: string, url: string) =>
    t.app.inject({ method: 'GET', url, headers: authHeader(token) });
  const act = (token: string, userId: string, payload: object) =>
    t.app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/actions`,
      headers: authHeader(token),
      payload,
    });
  const search = async (token: string, q: string) =>
    adminUserSearchResponse
      .parse((await get(token, `/api/admin/users?q=${encodeURIComponent(q)}`)).json())
      .items.map((u) => u.id);
  const moderator = async (): Promise<AuthResponse> => {
    const auth = await t.loginOnboarded();
    await setUser(t.db, auth.user.id, { isModerator: true });
    return auth;
  };
  const userRow = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0]!;

  it('finds users by @username, name prefix or exact Telegram id; % and _ match only themselves', async () => {
    const mod = await moderator();
    const anna = await insertUser(t.db, { firstName: 'Анна', lastName: 'Ковалёва', username: 'anna_k' });
    const promo = await insertUser(t.db, { firstName: '%скидки', username: 'sale50' });
    const other = await insertUser(t.db, { firstName: 'Антон', username: 'annex' });

    expect(await search(mod.token, '@anna_')).toEqual([anna.id]);
    expect(await search(mod.token, 'анн')).toEqual([anna.id]);
    expect(await search(mod.token, 'КОВАЛ')).toEqual([anna.id]);
    expect(await search(mod.token, String(other.telegramId))).toEqual([other.id]);
    expect(await search(mod.token, '%с')).toEqual([promo.id]);
    expect(await search(mod.token, 'an_ex')).toEqual([]);
    expect((await get(mod.token, '/api/admin/users?q=a')).statusCode).toBe(400);
  });

  it('shows the card; the moderator sees no admin powers, the admin does', async () => {
    const mod = await moderator();
    const subject = await t.loginOnboarded();
    const response = await get(mod.token, `/api/admin/users/${subject.user.id}`);
    expect(response.statusCode).toBe(200);
    expect(adminUserCardDto.parse(response.json())).toMatchObject({
      user: {
        id: subject.user.id,
        role: 'user',
        karma: KARMA.START,
        isShadowBanned: false,
        creationBlock: null,
      },
      stats: { hosted: 0, attended: 0, reportsReceived: 0 },
      block: null,
      openCases: [],
      history: [],
      isSelf: false,
      viewerIsAdmin: false,
    });
    const admin = await t.loginOnboarded(adminTelegramId);
    expect(
      adminUserCardDto.parse((await get(admin.token, `/api/admin/users/${mod.user.id}`)).json()),
    ).toMatchObject({
      user: { role: 'moderator' },
      viewerIsAdmin: true,
    });
    expect((await get(admin.token, `/api/admin/users/${admin.user.id}`)).json()).toMatchObject({
      user: { role: 'admin' },
      isSelf: true,
    });
    const missing = await get(mod.token, `/api/admin/users/${crypto.randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'user_not_found' });
  });

  it('bans and lifts, blocks and unblocks creation, and logs who did it', async () => {
    const mod = await moderator();
    const subject = await t.loginOnboarded();
    const [appeal] = await t.db
      .insert(moderationCases)
      .values({
        kind: 'appeal',
        subjectId: subject.user.id,
        appealText: 'Прошу разблокировать',
        openedAt: new Date(),
      })
      .returning({ id: moderationCases.id });

    expect(
      (await act(mod.token, subject.user.id, { action: 'shadow_ban', comment: 'Спам' })).statusCode,
    ).toBe(200);
    expect((await userRow(subject.user.id)).isShadowBanned).toBe(true);
    // A repeat changes nothing and logs nothing.
    await act(mod.token, subject.user.id, { action: 'shadow_ban' });
    await act(mod.token, subject.user.id, { action: 'lift_shadow_ban' });
    const blocked = adminUserCardDto.parse(
      (await act(mod.token, subject.user.id, { action: 'block_creation' })).json(),
    );
    expect(blocked.block).toMatchObject({ kind: 'moderation', lobby: null });
    expect(blocked.user.creationBlock).toBe('moderation');

    const card = adminUserCardDto.parse(
      (await act(mod.token, subject.user.id, { action: 'unblock_creation', comment: 'Разобрались' })).json(),
    );
    expect(card.block).toBeNull();
    expect(card.openCases).toEqual([]);
    expect(card.history.map((e) => [e.action, e.actor?.id, e.comment])).toEqual([
      ['unblock_creation', mod.user.id, 'Разобрались'],
      ['block_creation', mod.user.id, null],
      ['lift_shadow_ban', mod.user.id, null],
      ['shadow_ban', mod.user.id, 'Спам'],
    ]);
    const [closed] = await t.db.select().from(moderationCases).where(eq(moderationCases.id, appeal!.id));
    expect(closed).toMatchObject({
      decision: 'appeal_approved',
      resolvedBy: mod.user.id,
      decisionComment: 'Разобрались',
    });
  });

  it('changes karma by hand with a comment the user sees, up to KARMA.MAX', async () => {
    const mod = await moderator();
    const subject = await t.loginOnboarded();
    const missingComment = await act(mod.token, subject.user.id, { action: 'karma_change', karmaDelta: 5 });
    expect(missingComment.statusCode).toBe(400);
    for (const karmaDelta of [0, MODERATION_KARMA_DELTA_MAX + 1, null]) {
      expect(
        (await act(mod.token, subject.user.id, { action: 'karma_change', karmaDelta, comment: 'x' }))
          .statusCode,
      ).toBe(400);
    }

    await act(mod.token, subject.user.id, {
      action: 'karma_change',
      karmaDelta: 40,
      comment: 'Вёл встречи без нареканий',
    });
    await act(mod.token, subject.user.id, {
      action: 'karma_change',
      karmaDelta: 50,
      comment: 'Помог с организацией',
    });
    expect((await userRow(subject.user.id)).karma).toBe(KARMA.MAX);
    const card = adminUserCardDto.parse((await get(mod.token, `/api/admin/users/${subject.user.id}`)).json());
    expect(card.history.map((e) => e.karmaDelta)).toEqual([KARMA.MAX - KARMA.START - 40, 40]);

    const own = karmaEventsResponse.parse((await get(subject.token, '/api/me/karma-events')).json());
    expect(own.items.map((e) => [e.reason, e.delta, e.comment])).toEqual([
      ['manual', KARMA.MAX - KARMA.START - 40, 'Помог с организацией'],
      ['manual', 40, 'Вёл встречи без нареканий'],
    ]);
  });

  it('only admins appoint moderators; nobody acts on themselves', async () => {
    const mod = await moderator();
    const admin = await t.loginOnboarded(adminTelegramId);
    const candidate = await t.loginOnboarded();

    const refused = await act(mod.token, candidate.user.id, { action: 'grant_moderator' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'admin_only' });
    expect((await userRow(candidate.user.id)).isModerator).toBe(false);

    const granted = adminUserCardDto.parse(
      (await act(admin.token, candidate.user.id, { action: 'grant_moderator' })).json(),
    );
    expect(granted.user.role).toBe('moderator');
    expect((await get(candidate.token, '/api/admin/cases')).statusCode).toBe(200);
    await act(admin.token, candidate.user.id, { action: 'revoke_moderator' });
    expect((await get(candidate.token, '/api/admin/cases')).statusCode).toBe(403);

    for (const [token, id, action] of [
      [mod.token, mod.user.id, 'lift_shadow_ban'],
      [mod.token, mod.user.id, 'karma_change'],
      [admin.token, admin.user.id, 'revoke_moderator'],
    ] as const) {
      const response = await act(token, id, { action, karmaDelta: 10, comment: 'себе' });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'self_moderation' });
    }
    expect((await userRow(mod.user.id)).karma).toBe(KARMA.START);
    expect((await act(mod.token, crypto.randomUUID(), { action: 'shadow_ban' })).statusCode).toBe(404);
  });
});
