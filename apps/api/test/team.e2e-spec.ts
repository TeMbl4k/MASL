import { eq } from 'drizzle-orm';
import { lobbies, userArrivals, users } from '@masl/db';
import {
  APPLICATIONS_PENDING_MAX,
  HOSTED_UPCOMING_MAX,
  REPORTS_PER_DAY_MAX,
  SUPPORT_PER_DAY_MAX,
  adminStatsDto,
  adminSupportDto,
  adminSupportResponse,
  adminTeamResponse,
  apiErrorDto,
  linkTagsResponse,
  moscowDayKey,
  type AdminStatsDto,
  type ApiErrorCode,
  type AuthResponse,
} from '@masl/shared';
import {
  adminUrl,
  authHeader,
  bootApp,
  freshTelegramId,
  insertLobby,
  lobbyApi,
  makeOutboxDue,
  setMembership,
  setUser,
  type InjectResponse,
  type TestApp,
} from './helpers.js';

describe.skipIf(!adminUrl)(
  'feedback, admin statistics, team and limits e2e (requires TEST_DATABASE_URL)',
  () => {
    let t: TestApp;
    let api: ReturnType<typeof lobbyApi>;
    const adminTelegramId = freshTelegramId();
    // An admin by the setting who never opened the app.
    const absentAdminId = freshTelegramId();
    let admin: AuthResponse;

    beforeAll(async () => {
      t = await bootApp({ env: { ADMIN_TELEGRAM_IDS: `${adminTelegramId},${absentAdminId}` } });
      api = lobbyApi(t);
      admin = await t.loginOnboarded(adminTelegramId, 'Админ');
      await t.db.update(users).set({ allowsWriteToPm: true }).where(eq(users.id, admin.user.id));
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
    const post = (token: string, url: string, payload: object = {}) =>
      t.app.inject({ method: 'POST', url, headers: authHeader(token), payload });
    const support = (token: string, text = 'Не открывается карта на телефоне') =>
      post(token, '/api/me/support', { category: 'bug', text });
    const stats = async (period = '7d') =>
      adminStatsDto.parse((await get(admin.token, `/api/admin/stats?period=${period}`)).json());

    function expectError(response: InjectResponse, status: number, code: ApiErrorCode) {
      expect(response.statusCode, response.body).toBe(status);
      expect(apiErrorDto.parse(response.json()).code).toBe(code);
    }

    describe('«Написать нам»', () => {
      it('reaches admins only; one reply goes to the author through the bot', async () => {
        const author = await t.loginOnboarded(undefined, 'Автор');
        expect((await support(author.token)).json()).toEqual({ sent: true });
        await makeOutboxDue(t.db);
        await t.flushOutbox();
        const [note] = t.telegram.textsTo(adminTelegramId);
        expect(note).toContain('Новое обращение · Ошибка · Автор');
        expect(note).toContain('Не открывается карта на телефоне');

        const list = adminSupportResponse.parse((await get(admin.token, '/api/admin/support')).json());
        const request = list.items.find((r) => r.author.id === author.user.id)!;
        expect(request).toMatchObject({ status: 'open', category: 'bug', reply: null });
        const replied = adminSupportDto.parse(
          (
            await post(admin.token, `/api/admin/support/${request.id}/reply`, { text: 'Починили, обновите' })
          ).json(),
        );
        expect(replied).toMatchObject({
          status: 'closed',
          reply: 'Починили, обновите',
          repliedBy: { id: admin.user.id },
        });
        expectError(
          await post(admin.token, `/api/admin/support/${request.id}/reply`, { text: 'Ещё раз' }),
          409,
          'support_closed',
        );
        t.telegram.reset();
        await t.db.update(users).set({ allowsWriteToPm: true }).where(eq(users.id, author.user.id));
        await makeOutboxDue(t.db);
        await t.flushOutbox();
        expect(t.telegram.textsTo(author.user.telegramId)).toEqual([
          'Ответ на ваше обращение:\n\nПочинили, обновите',
        ]);
        const closed = adminSupportResponse.parse(
          (await get(admin.token, '/api/admin/support?status=closed')).json(),
        );
        expect(closed.items.map((r) => r.id)).toContain(request.id);
      });

      it('needs the agreement, not onboarding; limits ordinary users to a few a day', async () => {
        const fresh = await t.login();
        expectError(await support(fresh.token), 403, 'terms_not_accepted');
        await t.acceptTerms(fresh.token);
        for (let i = 0; i < SUPPORT_PER_DAY_MAX; i++) {
          t.resetRateLimits();
          expect((await support(fresh.token)).statusCode).toBe(200);
        }
        expectError(await support(fresh.token), 429, 'support_daily_limit');
        expect(
          (await post(fresh.token, '/api/me/support', { category: 'bug', text: 'коротко' })).statusCode,
        ).toBe(400);

        const moderator = await t.loginOnboarded();
        await setUser(t.db, moderator.user.id, { isModerator: true });
        for (let i = 0; i <= SUPPORT_PER_DAY_MAX; i++) {
          t.resetRateLimits();
          expect((await support(moderator.token)).statusCode).toBe(200);
        }
      });

      it('keeps «Обращения», statistics, the team and tags from moderators and users', async () => {
        const moderator = await t.loginOnboarded();
        await setUser(t.db, moderator.user.id, { isModerator: true });
        const user = await t.loginOnboarded();
        for (const url of ['/api/admin/support', '/api/admin/stats', '/api/admin/team', '/api/admin/tags']) {
          expectError(await get(moderator.token, url), 403, 'admin_section');
          expectError(await get(user.token, url), 403, 'forbidden_moderation');
        }
        const [anyRequest] = adminSupportResponse.parse(
          (await get(admin.token, '/api/admin/support')).json(),
        ).items;
        if (anyRequest) {
          expectError(
            await post(moderator.token, `/api/admin/support/${anyRequest.id}/close`),
            403,
            'admin_section',
          );
        }
      });
    });

    describe('statistics', () => {
      it('counts uniques, sign-ups, lobbies, attendance, returning people, reports and sources', async () => {
        const before = await stats();
        const friend = await t.loginOnboarded(undefined, 'Друг');
        const viaFriend = await t.loginOnboarded();
        await post(viaFriend.token, '/api/me/arrival', {
          startParam: `p_${friend.user.publicCode}_${friend.user.publicCode}`,
        });
        await post(admin.token, '/api/admin/tags', { slug: 'stats-tag', title: 'Канал' });
        const viaTag = await t.login();
        await post(viaTag.token, '/api/me/arrival', { startParam: 't_stats-tag' });

        const held = await insertLobby(t.db, { hostId: friend.user.id, startsInMin: -6 * 60 });
        const second = await insertLobby(t.db, { hostId: friend.user.id, startsInMin: -4 * 60 });
        await setMembership(t.db, held.id, viaFriend.user.id, 'attended');
        await setMembership(t.db, second.id, viaFriend.user.id, 'attended');
        await setMembership(t.db, second.id, viaTag.user.id, 'no_show');
        const cancelled = await insertLobby(t.db, { hostId: friend.user.id, status: 'cancelled' });
        await post(viaFriend.token, `/api/lobbies/${cancelled.id}/reports`, { reason: 'promo' });

        const after = await stats();
        const delta = (pick: (s: AdminStatsDto) => number) => pick(after) - pick(before);
        expect(delta((s) => s.uniques.today)).toBe(3);
        expect(delta((s) => s.users.new)).toBe(3);
        expect(delta((s) => s.users.onboarded)).toBe(2);
        expect(delta((s) => s.lobbies.created)).toBe(3);
        expect(delta((s) => s.lobbies.held)).toBe(2);
        expect(delta((s) => s.lobbies.cancelled)).toBe(1);
        expect(delta((s) => s.attendance.attended)).toBe(2);
        expect(delta((s) => s.attendance.noShow)).toBe(1);
        expect(delta((s) => s.returning)).toBe(1);
        expect(delta((s) => s.reports)).toBe(1);
        expect(after.sources).toContainEqual({
          kind: 'tag',
          tag: { slug: 'stats-tag', title: 'Канал' },
          newUsers: 1,
          onboarded: 0,
          attended: 0,
        });
        const friends = (s: AdminStatsDto) => s.sources.find((x) => x.kind === 'friends')?.attended ?? 0;
        expect(friends(after) - friends(before)).toBe(1);
        expect(after.byDay).toHaveLength(7);
        expect(after.byDay.at(-1)!.date).toBe(moscowDayKey(new Date()));
        expect((await stats('30d')).byDay).toHaveLength(30);
        // Only numbers: no names or ids of people.
        const body = JSON.stringify(after);
        expect(body).not.toContain(friend.user.id);
        expect(body).not.toContain('Друг');
      });
    });

    describe('team and tags', () => {
      it('lists admins from the setting and appointed moderators', async () => {
        const moderator = await t.loginOnboarded(undefined, 'Модератор');
        expect(
          (
            await post(admin.token, `/api/admin/users/${moderator.user.id}/actions`, {
              action: 'grant_moderator',
            })
          ).statusCode,
        ).toBe(200);
        const team = adminTeamResponse.parse((await get(admin.token, '/api/admin/team')).json());
        expect(team.items.slice(0, 2)).toEqual([
          {
            role: 'admin',
            telegramId: adminTelegramId,
            user: { id: admin.user.id, firstName: 'Админ', username: null },
            since: null,
          },
          { role: 'admin', telegramId: absentAdminId, user: null, since: null },
        ]);
        const mod = team.items.find((m) => m.user?.id === moderator.user.id);
        expect(mod).toMatchObject({ role: 'moderator', since: expect.any(String) });
      });

      it('creates tags once, with a link; bad slugs are refused', async () => {
        const created = linkTagsResponse.parse(
          (await post(admin.token, '/api/admin/tags', { slug: ' Sticker-1 ', title: 'Стикеры' })).json(),
        );
        expect(created.items[0]).toMatchObject({
          slug: 'sticker-1',
          title: 'Стикеры',
          link: 'https://t.me/masl_test_bot?startapp=t_sticker-1',
          arrivals: 0,
        });
        expectError(
          await post(admin.token, '/api/admin/tags', { slug: 'sticker-1', title: 'Повтор' }),
          409,
          'tag_exists',
        );
        for (const slug of ['with_underscore', 'кириллица', 'a'.repeat(33), '']) {
          expect((await post(admin.token, '/api/admin/tags', { slug, title: 'x' })).statusCode, slug).toBe(
            400,
          );
        }
        const newcomer = await t.login();
        await post(newcomer.token, '/api/me/arrival', { startParam: 't_sticker-1' });
        const [arrival] = await t.db
          .select()
          .from(userArrivals)
          .where(eq(userArrivals.userId, newcomer.user.id));
        expect(arrival?.tagId).toBe(created.items[0]!.id);
        const tags = linkTagsResponse.parse((await get(admin.token, '/api/admin/tags')).json());
        expect(tags.items.find((tag) => tag.slug === 'sticker-1')?.arrivals).toBe(1);
      });
    });

    describe('limits of the team', () => {
      it('lifts the lobby, application and report caps for a moderator, and brings them back on revoke', async () => {
        const mod = await t.loginOnboarded();
        await setUser(t.db, mod.user.id, { isModerator: true });
        // A newbie: one lobby a day and HOSTED_UPCOMING_MAX upcoming, for an ordinary user.
        for (let i = 0; i <= HOSTED_UPCOMING_MAX; i++) {
          t.resetRateLimits();
          expect((await t.createLobby(mod.token)).statusCode, `lobby ${i + 1}`).toBe(201);
        }
        const host = await t.loginOnboarded();
        const open = [];
        for (let i = 0; i <= APPLICATIONS_PENDING_MAX; i++)
          open.push(await insertLobby(t.db, { hostId: host.user.id }));
        for (const lobby of open) {
          t.resetRateLimits();
          expect((await api.apply(mod.token, lobby.id)).statusCode).toBe(201);
        }
        for (let i = 0; i <= REPORTS_PER_DAY_MAX; i++) {
          t.resetRateLimits();
          const lobby = await insertLobby(t.db, { hostId: host.user.id });
          expect(
            (await post(mod.token, `/api/lobbies/${lobby.id}/reports`, { reason: 'promo' })).statusCode,
          ).toBe(200);
        }

        await setUser(t.db, mod.user.id, { isModerator: false });
        t.resetRateLimits();
        expectError(await t.createLobby(mod.token), 429, 'daily_limit');
        const extra = await insertLobby(t.db, { hostId: host.user.id });
        expectError(await api.apply(mod.token, extra.id), 429, 'pending_limit');
        expectError(
          await post(mod.token, `/api/lobbies/${extra.id}/reports`, { reason: 'promo' }),
          429,
          'reports_daily_limit',
        );
        // Lobbies the moderator created stay.
        expect((await t.db.select().from(lobbies).where(eq(lobbies.hostId, mod.user.id))).length).toBe(
          HOSTED_UPCOMING_MAX + 1,
        );
      });
    });
  },
);
