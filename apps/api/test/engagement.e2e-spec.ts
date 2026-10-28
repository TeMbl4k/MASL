import { and, eq, sql } from 'drizzle-orm';
import { linkTags, notifications, userAchievements, userArrivals, users } from '@masl/db';
import {
  ACHIEVEMENTS,
  BROADCAST_GAP_HOURS,
  HOUR_MS,
  QR_PRINTS_PER_DAY,
  apiErrorDto,
  broadcastAudienceDto,
  broadcastsResponse,
  linkTagsResponse,
  lobbyDetailDto,
  meDto,
  myAchievementsResponse,
  publicProfileDto,
  qrPrintResponse,
  type ApiErrorCode,
  type AuthResponse,
} from '@masl/shared';
import { AchievementsService } from '../src/achievements/achievements.service.js';
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
  'achievements, friends, QR and broadcasts e2e (requires TEST_DATABASE_URL)',
  () => {
    let t: TestApp;
    let api: ReturnType<typeof lobbyApi>;
    const adminTelegramId = freshTelegramId();
    let admin: AuthResponse;

    beforeAll(async () => {
      t = await bootApp({ env: { ADMIN_TELEGRAM_IDS: String(adminTelegramId) } });
      api = lobbyApi(t);
      admin = await t.loginOnboarded(adminTelegramId, 'Админ');
      await allowPm(admin.user.id);
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
    const send = (method: 'POST' | 'PUT', token: string, url: string, payload: object = {}) =>
      t.app.inject({ method, url, headers: authHeader(token), payload });
    const allowPm = (userId: string, allowed = true) =>
      t.db.update(users).set({ allowsWriteToPm: allowed }).where(eq(users.id, userId));
    const mine = async (token: string) =>
      myAchievementsResponse.parse((await get(token, '/api/me/achievements')).json());
    const earnedOf = async (userId: string) =>
      (await t.db.select().from(userAchievements).where(eq(userAchievements.userId, userId))).map(
        (row) => row.achievement,
      );
    const queuedFor = (userId: string, kind: string) =>
      t.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.kind, kind as never)));
    const deliver = async () => {
      await makeOutboxDue(t.db);
      await t.flushOutbox();
    };

    function expectError(response: InjectResponse, status: number, code: ApiErrorCode) {
      expect(response.statusCode, response.body).toBe(status);
      expect(apiErrorDto.parse(response.json()).code).toBe(code);
    }

    /** A lobby of `host` that ended 2.5 hours ago with the given approved members. */
    async function endedMeetup(host: AuthResponse, members: AuthResponse[], slots = 4) {
      const lobby = await insertLobby(t.db, {
        hostId: host.user.id,
        now: new Date(Date.now() - 4 * 24 * HOUR_MS),
        startsInMin: 4 * 24 * 60 - 150,
        slots,
        title: 'Настолки',
      });
      const ids: string[] = [];
      for (const member of members) {
        ids.push((await setMembership(t.db, lobby.id, member.user.id, 'approved')).id);
      }
      return { lobby, ids };
    }

    describe('achievements', () => {
      it('come with the saved marks, once, and the bot tells about them in one message', async () => {
        const host = await t.loginOnboarded(undefined, 'Хост');
        const came = await t.loginOnboarded(undefined, 'Пришла');
        const absent = await t.loginOnboarded();
        await allowPm(came.user.id);
        const { lobby, ids } = await endedMeetup(host, [came, absent], 3);

        const saved = await api.saveAttendance(host.token, lobby.id, [ids[1]!]);
        expect(saved.statusCode, saved.body).toBe(200);
        expect(await earnedOf(came.user.id)).toEqual(['first_meetup']);
        // One of three places stayed empty: no «Полный сбор».
        expect(await earnedOf(host.user.id)).toEqual(['first_hosted']);
        expect(await earnedOf(absent.user.id)).toEqual([]);

        const [message] = await queuedFor(came.user.id, 'user_achievements');
        expect(message!.sendAfter.getTime()).toBeGreaterThan(Date.now() + 30_000);
        await deliver();
        const announced = t.telegram
          .textsTo(came.user.telegramId)
          .filter((m) => m.startsWith('Новая ачивка'));
        expect(announced).toEqual([expect.stringContaining('Новая ачивка: «Первая встреча»')]);

        const me = meDto.parse((await get(came.token, '/api/me')).json());
        expect(me.newAchievements).toEqual(['first_meetup']);
        expect((await send('POST', came.token, '/api/me/achievements/seen')).json()).toEqual({ seen: 1 });
        expect(meDto.parse((await get(came.token, '/api/me')).json()).newAchievements).toEqual([]);

        const body = await mine(came.token);
        expect(body.items.map((i) => i.id)).toEqual([...ACHIEVEMENTS]);
        expect(body.items.find((i) => i.id === 'first_meetup')).toMatchObject({ current: 1, goal: 1 });
        expect(body.items.find((i) => i.id === 'regular')).toMatchObject({ earnedAt: null, current: 1 });
        // 1 of 4 categories is the largest share.
        expect(body.next).toBe('versatile');

        // A recount gives nothing new and says nothing.
        expect(await t.app.get(AchievementsService).backfill()).toBe(0);
        expect(await earnedOf(came.user.id)).toEqual(['first_meetup']);
      });

      it('a host shows up to two badges on the lobby page', async () => {
        const host = await t.loginOnboarded();
        const members = [await t.loginOnboarded(), await t.loginOnboarded(), await t.loginOnboarded()];
        const { lobby } = await endedMeetup(host, members, 3);
        await api.saveAttendance(host.token, lobby.id, []);
        const open = await insertLobby(t.db, { hostId: host.user.id });
        const viewer = await t.loginOnboarded();
        expect(lobbyDetailDto.parse((await api.detail(viewer.token, open.id)).json()).hostBadges).toEqual([
          'full_house',
        ]);

        await t.db.insert(userAchievements).values(
          (['organizer', 'local', 'no_skips'] as const).map((achievement) => ({
            userId: host.user.id,
            achievement,
            earnedAt: new Date(),
            silent: true,
          })),
        );
        expect(lobbyDetailDto.parse((await api.detail(viewer.token, open.id)).json()).hostBadges).toEqual([
          'organizer',
          'full_house',
        ]);
      });

      it('the backfill gives past meetups silently', async () => {
        const host = await t.loginOnboarded();
        const member = await t.loginOnboarded();
        await allowPm(member.user.id);
        const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -300 });
        await setMembership(t.db, lobby.id, member.user.id, 'attended');

        expect(await t.app.get(AchievementsService).backfill()).toBeGreaterThanOrEqual(2);
        const rows = await t.db
          .select()
          .from(userAchievements)
          .where(eq(userAchievements.userId, member.user.id));
        expect(rows).toEqual([expect.objectContaining({ achievement: 'first_meetup', silent: true })]);
        expect(await queuedFor(member.user.id, 'user_achievements')).toEqual([]);
        expect(await earnedOf(host.user.id)).toContain('first_hosted');
      });

      it('B sees A’s earned achievements on the profile, never A’s progress or friends', async () => {
        const a = await t.loginOnboarded();
        const b = await t.loginOnboarded();
        await t.db
          .insert(userAchievements)
          .values({ userId: a.user.id, achievement: 'explorer', earnedAt: new Date(), silent: false });
        const profile = publicProfileDto.parse(
          (await get(b.token, `/api/people/${a.user.publicCode}`)).json(),
        );
        expect(profile.achievements).toEqual(['explorer']);
        expect(profile).not.toHaveProperty('friends');

        // The own endpoint has no parameter: B's request is B's data.
        const own = await mine(b.token);
        expect(own.items.every((i) => i.earnedAt === null)).toBe(true);
        expect(
          (
            await t.app.inject({
              method: 'GET',
              url: `/api/me/achievements?userId=${a.user.id}`,
              headers: authHeader(b.token),
            })
          ).json(),
        ).toEqual(own);
        expect((await send('POST', b.token, '/api/me/achievements/seen')).json()).toEqual({ seen: 0 });
        expect(meDto.parse((await get(a.token, '/api/me')).json()).newAchievements).toEqual(['explorer']);

        await setUser(t.db, a.user.id, { isShadowBanned: true });
        expect((await get(b.token, `/api/people/${a.user.publicCode}`)).statusCode).toBe(404);
      });
    });

    describe('a friend', () => {
      async function referred(referrer: AuthResponse) {
        const friend = await t.loginOnboarded(undefined, 'Друг');
        await t.db
          .insert(userArrivals)
          .values({ userId: friend.user.id, referrerId: referrer.user.id, createdAt: new Date() });
        return friend;
      }

      it('counts at the first meetup of another host, once', async () => {
        const referrer = await t.loginOnboarded();
        await allowPm(referrer.user.id);
        const friend = await referred(referrer);
        await referred(referrer);
        const host = await t.loginOnboarded();
        const { lobby } = await endedMeetup(host, [friend]);
        await api.saveAttendance(host.token, lobby.id, []);

        expect((await mine(referrer.token)).friends).toEqual({ arrived: 2, reached: 1 });
        expect(await earnedOf(referrer.user.id)).toEqual(['brought_friend']);
        expect(await queuedFor(referrer.user.id, 'user_friend_counted')).toHaveLength(1);
        await deliver();
        const texts = t.telegram.textsTo(referrer.user.telegramId);
        // Not companions: the friend is not named.
        expect(texts).toContain(
          'Друг, который пришёл по вашей ссылке, сходил на первую встречу.\nПо вашей ссылке пришли: 2, дошли до встречи: 1.',
        );

        // A second meetup of the same friend says nothing more.
        const again = await endedMeetup(host, [friend]);
        await api.saveAttendance(host.token, again.lobby.id, []);
        expect(await queuedFor(referrer.user.id, 'user_friend_counted')).toHaveLength(1);
        expect((await mine(referrer.token)).friends.reached).toBe(1);
      });

      it('never counts at the referrer’s own meetup', async () => {
        const referrer = await t.loginOnboarded();
        const friend = await referred(referrer);
        const { lobby } = await endedMeetup(referrer, [friend]);
        await api.saveAttendance(referrer.token, lobby.id, []);
        expect((await mine(referrer.token)).friends).toEqual({ arrived: 1, reached: 0 });
        expect(await queuedFor(referrer.user.id, 'user_friend_counted')).toEqual([]);
        expect(await earnedOf(referrer.user.id)).not.toContain('brought_friend');

        // Their first meetup elsewhere is the first that counts.
        const host = await t.loginOnboarded();
        const elsewhere = await endedMeetup(host, [friend]);
        await api.saveAttendance(host.token, elsewhere.lobby.id, []);
        expect((await mine(referrer.token)).friends.reached).toBe(1);
        expect(await queuedFor(referrer.user.id, 'user_friend_counted')).toHaveLength(1);
      });
    });

    describe('«Прислать для печати»', () => {
      it('sends the own card as an SVG file, at most QR_PRINTS_PER_DAY a day', async () => {
        const user = await t.loginOnboarded();
        expectError(await send('POST', user.token, '/api/me/card/print'), 409, 'bot_blocked');
        await allowPm(user.user.id);
        for (let i = 0; i < QR_PRINTS_PER_DAY; i++) {
          t.resetRateLimits();
          const body = qrPrintResponse.parse((await send('POST', user.token, '/api/me/card/print')).json());
          expect(body.left).toBe(QR_PRINTS_PER_DAY - i - 1);
        }
        t.resetRateLimits();
        expectError(await send('POST', user.token, '/api/me/card/print'), 429, 'qr_prints_daily_limit');

        await deliver();
        const files = t.telegram.sent('sendDocument', user.user.telegramId);
        expect(files).toHaveLength(QR_PRINTS_PER_DAY);
        expect(String(files[0]!.payload.caption)).toContain('QR вашей визитки');

        // The window rolls: a day later there is room again.
        await t.db
          .update(notifications)
          .set({ createdAt: sql`${notifications.createdAt} - interval '25 hours'` })
          .where(and(eq(notifications.userId, user.user.id), eq(notifications.kind, 'user_qr_print')));
        t.resetRateLimits();
        expect((await send('POST', user.token, '/api/me/card/print')).statusCode).toBe(200);
      });

      it('has no cap for the team', async () => {
        const moderator = await t.loginOnboarded();
        await setUser(t.db, moderator.user.id, { isModerator: true });
        await allowPm(moderator.user.id);
        for (let i = 0; i <= QR_PRINTS_PER_DAY; i++) {
          t.resetRateLimits();
          expect(
            qrPrintResponse.parse((await send('POST', moderator.token, '/api/me/card/print')).json()).left,
          ).toBeNull();
        }
      });

      it('prints a link tag for admins only', async () => {
        const [tag] = await t.db
          .insert(linkTags)
          .values({ slug: 'stickers', title: 'Стикеры', createdAt: new Date() })
          .returning();
        const moderator = await t.loginOnboarded();
        await setUser(t.db, moderator.user.id, { isModerator: true });
        const user = await t.loginOnboarded();
        for (const caller of [user, moderator]) {
          expect((await send('POST', caller.token, `/api/admin/tags/${tag!.id}/print`)).statusCode).toBe(403);
        }
        expectError(await send('POST', admin.token, '/api/admin/tags/999999/print'), 404, 'tag_not_found');
        expect((await send('POST', admin.token, '/api/admin/tags/abc/print')).statusCode).toBe(400);
        expect(
          qrPrintResponse.parse((await send('POST', admin.token, `/api/admin/tags/${tag!.id}/print`)).json()),
        ).toEqual({
          sent: true,
          left: null,
        });
        await deliver();
        const [file] = t.telegram.sent('sendDocument', adminTelegramId);
        expect(String(file!.payload.caption)).toContain('«Стикеры»');

        // «пришли N, до встречи M» of the tag.
        const [came, stayed] = [await t.loginOnboarded(), await t.loginOnboarded()];
        for (const u of [came, stayed]) {
          await t.db
            .insert(userArrivals)
            .values({ userId: u.user.id, tagId: tag!.id, createdAt: new Date() });
        }
        const host = await t.loginOnboarded();
        const { lobby } = await endedMeetup(host, [came]);
        await api.saveAttendance(host.token, lobby.id, []);
        const tags = linkTagsResponse.parse((await get(admin.token, '/api/admin/tags')).json());
        expect(tags.items.find((item) => item.id === tag!.id)).toMatchObject({ arrivals: 2, attended: 1 });
      });
    });

    describe('broadcasts', () => {
      const post = (token: string, url: string, payload: object) => send('POST', token, url, payload);
      const draft = (patch: object = {}) => ({
        text: 'Новая неделя в MASL: встречи у метро каждый вечер',
        interests: null,
        lobbyId: null,
        ...patch,
      });

      beforeEach(async () => {
        // Each test starts with nobody having received a broadcast recently.
        await t.db.delete(notifications).where(eq(notifications.kind, 'user_broadcast'));
      });

      it('are for admins only', async () => {
        const moderator = await t.loginOnboarded();
        await setUser(t.db, moderator.user.id, { isModerator: true });
        const user = await t.loginOnboarded();
        for (const caller of [user, moderator]) {
          expect((await get(caller.token, '/api/admin/broadcasts')).statusCode).toBe(403);
          expect(
            (await post(caller.token, '/api/admin/broadcasts/audience', { interests: null })).statusCode,
          ).toBe(403);
          expect((await post(caller.token, '/api/admin/broadcasts/test', draft())).statusCode).toBe(403);
          expect((await post(caller.token, '/api/admin/broadcasts', draft())).statusCode).toBe(403);
        }
      });

      it('reach subscribed people with the bot, once a day each, as plain text', async () => {
        const reader = await t.loginOnboarded(undefined, 'Читатель');
        const unsubscribed = await t.loginOnboarded();
        const blocked = await t.loginOnboarded();
        const banned = await t.loginOnboarded();
        const outsider = await t.login();
        await t.onboard(outsider.token, ['cinema', 'music', 'walks']);
        for (const u of [reader, unsubscribed, banned, outsider]) await allowPm(u.user.id);
        await allowPm(blocked.user.id, false);
        await send('PUT', unsubscribed.token, '/api/me/privacy', {
          hideFromSearch: false,
          invitesEnabled: true,
          newsEnabled: false,
        });
        await setUser(t.db, banned.user.id, { isShadowBanned: true });

        const audience = broadcastAudienceDto.parse(
          (await post(admin.token, '/api/admin/broadcasts/audience', { interests: ['boardgames'] })).json(),
        );
        expect(audience.skipped.unsubscribed).toBeGreaterThanOrEqual(1);
        expect(audience.skipped.botBlocked).toBeGreaterThanOrEqual(1);

        const text = 'Привет! <b>Не жирный</b> текст и *звёздочки* как есть';
        const sent = await post(
          admin.token,
          '/api/admin/broadcasts',
          draft({ text, interests: ['boardgames'] }),
        );
        expect(sent.statusCode, sent.body).toBe(201);
        const history = broadcastsResponse.parse(sent.json());
        expect(history.items[0]).toMatchObject({
          text,
          recipients: audience.recipients,
          pending: audience.recipients,
        });

        await t.flushOutbox();
        const [message] = t.telegram.sent('sendMessage', reader.user.telegramId);
        expect(message!.payload.text).toBe(text);
        expect(message!.payload).not.toHaveProperty('parse_mode');
        for (const skipped of [unsubscribed, blocked, banned, outsider]) {
          expect(t.telegram.textsTo(skipped.user.telegramId)).toEqual([]);
        }

        // The next one within BROADCAST_GAP_HOURS skips everyone the first reached.
        const rest = broadcastAudienceDto.parse(
          (await post(admin.token, '/api/admin/broadcasts/audience', { interests: null })).json(),
        );
        expect(rest.skipped.recent).toBe(audience.recipients);
        const second = broadcastsResponse.parse(
          (await post(admin.token, '/api/admin/broadcasts', draft())).json(),
        );
        expect(second.items[0]!.recipients).toBe(rest.recipients);
        expect(await queuedFor(reader.user.id, 'user_broadcast')).toHaveLength(1);
        await t.db
          .update(notifications)
          .set({ createdAt: new Date(Date.now() - (BROADCAST_GAP_HOURS + 1) * HOUR_MS) })
          .where(eq(notifications.kind, 'user_broadcast'));
        await post(admin.token, '/api/admin/broadcasts', draft());
        expect(await queuedFor(reader.user.id, 'user_broadcast')).toHaveLength(2);
      });

      it('«Отписаться от новостей» stops broadcasts, not the messages about meetups', async () => {
        const reader = await t.loginOnboarded();
        await allowPm(reader.user.id);
        const history = broadcastsResponse.parse(
          (await post(admin.token, '/api/admin/broadcasts', draft())).json(),
        );
        const broadcastId = history.items[0]!.id;
        await t.flushOutbox();
        const [message] = t.telegram.sent('sendMessage', reader.user.telegramId);
        const rows = (
          message!.payload.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] }
        ).inline_keyboard;
        const unsubscribe = rows.flat().find((b) => b.text === 'Отписаться от новостей')!;
        expect(unsubscribe.callback_data).toBe(`n:off:${broadcastId}`);

        const tap = () =>
          t.handleUpdate({
            callback_query: {
              id: String(Math.random()),
              from: { id: reader.user.telegramId, is_bot: false, first_name: 'Тест' },
              chat_instance: 'chat',
              data: unsubscribe.callback_data,
              message: {
                message_id: 10,
                date: 0,
                chat: { id: reader.user.telegramId, type: 'private', first_name: 'Тест' },
                text: 'Новости',
                reply_markup: { inline_keyboard: rows as never },
              },
            },
          });
        await tap();
        expect(meDto.parse((await get(reader.token, '/api/me')).json()).newsEnabled).toBe(false);
        expect(t.telegram.textsTo(reader.user.telegramId).at(-1)).toMatch(/^Вы отписались от новостей/);
        expect(
          broadcastsResponse.parse((await get(admin.token, '/api/admin/broadcasts')).json()).items[0],
        ).toMatchObject({
          id: broadcastId,
          unsubscribed: 1,
        });
        await tap();
        expect(t.telegram.sent('answerCallbackQuery').at(-1)!.payload.text).toBe(
          'Вы уже отписаны от новостей',
        );

        // A broadcast queued before the unsubscribe isn't sent after it.
        await t.db.delete(notifications).where(eq(notifications.kind, 'user_broadcast'));
        await send('PUT', reader.token, '/api/me/privacy', {
          hideFromSearch: false,
          invitesEnabled: true,
          newsEnabled: true,
        });
        await post(admin.token, '/api/admin/broadcasts', draft());
        await t.db.update(users).set({ newsEnabled: false }).where(eq(users.id, reader.user.id));
        t.telegram.reset();
        await t.flushOutbox();
        expect(t.telegram.textsTo(reader.user.telegramId)).toEqual([]);

        // Service messages still come.
        await allowPm(reader.user.id);
        expect((await send('POST', reader.token, '/api/me/card/print')).statusCode).toBe(200);
        await t.flushOutbox();
        expect(t.telegram.sent('sendDocument', reader.user.telegramId)).toHaveLength(1);
      });

      it('a test goes to the admin at once; a lobby button needs an open lobby', async () => {
        const ok = await post(admin.token, '/api/admin/broadcasts/test', draft());
        expect(ok.json()).toEqual({ sent: true });
        expect(t.telegram.textsTo(adminTelegramId)).toEqual([draft().text]);

        const host = await t.loginOnboarded();
        const ended = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -300 });
        expectError(
          await post(admin.token, '/api/admin/broadcasts/test', draft({ lobbyId: ended.id })),
          409,
          'lobby_closed',
        );
        expectError(
          await post(admin.token, '/api/admin/broadcasts', draft({ lobbyId: crypto.randomUUID() })),
          404,
          'lobby_not_found',
        );
        const open = await insertLobby(t.db, { hostId: host.user.id });
        t.telegram.reset();
        await post(admin.token, '/api/admin/broadcasts/test', draft({ lobbyId: open.id }));
        const [message] = t.telegram.sent('sendMessage', adminTelegramId);
        expect(JSON.stringify(message!.payload.reply_markup)).toContain(`/lobby/${open.id}`);

        t.telegram.fail('sendMessage', {
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        });
        expectError(await post(admin.token, '/api/admin/broadcasts/test', draft()), 409, 'bot_blocked');
        expect(
          (await post(admin.token, '/api/admin/broadcasts', draft({ text: 'коротко' }))).statusCode,
        ).toBe(400);
      });
    });
  },
);
