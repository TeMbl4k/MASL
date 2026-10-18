import { and, eq } from 'drizzle-orm';
import { lobbies, lobbyFeedback, lobbyMembers, moderationCases, notifications, users } from '@masl/db';
import {
  KARMA,
  attendanceResponse,
  lobbyDetailDto,
  myLobbiesResponse,
  type AttendanceResponse,
} from '@masl/shared';
import { LobbyStatusSweeper } from '../src/lobbies/lobby-status.sweeper.js';
import {
  CANARY_POINT,
  adminUrl,
  authHeader,
  bootApp,
  freshChatId,
  insertLobby,
  karmaEventsOf,
  linkChat,
  lobbyApi,
  setMembership,
  type TestApp,
} from './helpers.js';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** About 220 m from the canary point: inside the check-in radius. */
const NEAR = { lat: CANARY_POINT.lat + 0.002, lng: CANARY_POINT.lng };
/** About 1.1 km away: outside it. */
const FAR = { lat: CANARY_POINT.lat + 0.01, lng: CANARY_POINT.lng };

describe.skipIf(!adminUrl)('check-in, attendance and feedback e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  let api: ReturnType<typeof lobbyApi>;
  let sweeper: LobbyStatusSweeper;

  beforeAll(async () => {
    t = await bootApp();
    api = lobbyApi(t);
    sweeper = t.app.get(LobbyStatusSweeper);
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    t.telegram.reset();
  });

  const queued = (lobbyId: string, kind: string) =>
    t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.lobbyId, lobbyId), eq(notifications.kind, kind as never)));
  const lobbyRow = async (id: string) => (await t.db.select().from(lobbies).where(eq(lobbies.id, id)))[0]!;
  const karmaOf = async (userId: string) =>
    (await t.db.select({ karma: users.karma }).from(users).where(eq(users.id, userId)))[0]!.karma;
  const memberRow = async (id: string) =>
    (await t.db.select().from(lobbyMembers).where(eq(lobbyMembers.id, id)))[0]!;
  const checkIn = (memberId: string, minutesAgo = 30) =>
    t.db
      .update(lobbyMembers)
      .set({ checkedInAt: new Date(Date.now() - minutesAgo * MINUTE_MS) })
      .where(eq(lobbyMembers.id, memberId));
  const tap = (telegramId: number, data: string, text = 'Сообщение бота') =>
    t.handleUpdate({
      callback_query: {
        id: String(Math.random()),
        from: { id: telegramId, is_bot: false, first_name: 'Тест' },
        chat_instance: 'chat',
        data,
        message: {
          message_id: 10,
          date: 0,
          chat: { id: telegramId, type: 'private', first_name: 'Тест' },
          text,
        },
      },
    });
  const answers = () => t.telegram.sent('answerCallbackQuery').map((c) => c.payload.text);

  /**
   * A lobby with three approved members that ended `endedMinAgo` minutes ago (negative: still
   * ahead or under way, by start time `startsInMin`).
   */
  async function meetup(options: { startsInMin: number; durationMin?: number; members?: number }) {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, {
      hostId: host.user.id,
      now: new Date(Date.now() - 4 * 24 * HOUR_MS),
      startsInMin: 4 * 24 * 60 + options.startsInMin,
      durationMin: options.durationMin ?? 120,
      slots: 4,
      title: 'Настолки',
    });
    const members = [];
    for (let i = 0; i < (options.members ?? 3); i++) {
      const member = await t.loginOnboarded();
      const row = await setMembership(t.db, lobby.id, member.user.id, 'approved');
      members.push({ ...member, applicationId: row.id });
    }
    return { host, lobby, members };
  }

  describe('«Я на месте»', () => {
    it('opens 30 minutes before the start, needs the place nearby and keeps the first mark', async () => {
      const early = await meetup({ startsInMin: 45 });
      const tooEarly = await api.checkIn(early.members[0]!.token, early.lobby.id, NEAR);
      expect(tooEarly.statusCode).toBe(409);
      expect(tooEarly.json()).toMatchObject({ code: 'check_in_not_open' });

      const { lobby, members } = await meetup({ startsInMin: 10 });
      const member = members[0]!;
      const far = await api.checkIn(member.token, lobby.id, FAR);
      expect(far.statusCode).toBe(409);
      expect(far.json()).toEqual({
        statusCode: 409,
        code: 'check_in_too_far',
        message: 'Вы далеко от места встречи. Подойдите ближе и попробуйте ещё раз',
      });
      expect((await memberRow(member.applicationId)).checkedInAt).toBeNull();

      const near = await api.checkIn(member.token, lobby.id, NEAR);
      expect(near.statusCode).toBe(200);
      const detail = lobbyDetailDto.parse(near.json());
      const first = detail.checkIn?.checkedInAt;
      expect(first).toEqual(expect.any(String));
      expect(detail.checkIn?.opensAt).toBe(new Date(lobby.startsAt.getTime() - 30 * MINUTE_MS).toISOString());

      const repeat = lobbyDetailDto.parse((await api.checkIn(member.token, lobby.id, FAR)).json());
      expect(repeat.checkIn?.checkedInAt).toBe(first);
    });

    it('is only for approved members of a lobby that has not ended', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -10 });
      const pending = await t.loginOnboarded();
      await setMembership(t.db, lobby.id, pending.user.id, 'pending');
      const outsider = await t.loginOnboarded();
      for (const who of [host, pending, outsider]) {
        const response = await api.checkIn(who.token, lobby.id, NEAR);
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: 'check_in_closed' });
      }
      expect((await api.checkIn(members[0]!.token, lobby.id, NEAR)).statusCode).toBe(200);
      // Another member's mark is untouched by this one.
      expect((await memberRow(members[1]!.applicationId)).checkedInAt).toBeNull();

      const ended = await meetup({ startsInMin: -130 });
      expect((await api.checkIn(ended.members[0]!.token, ended.lobby.id, NEAR)).json()).toMatchObject({
        code: 'check_in_closed',
      });
      expect((await api.checkIn(members[0]!.token, crypto.randomUUID(), NEAR)).statusCode).toBe(404);
    });
  });

  describe('attendance in the app', () => {
    it('opens at the end, for the host only', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -30 });
      const early = attendanceResponse.parse((await api.attendance(host.token, lobby.id)).json());
      expect(early.state).toBe('not_yet');
      expect((await api.saveAttendance(host.token, lobby.id, [])).json()).toMatchObject({
        code: 'attendance_not_open',
      });
      for (const response of [
        await api.attendance(members[0]!.token, lobby.id),
        await api.saveAttendance(members[0]!.token, lobby.id, []),
      ]) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ code: 'not_host' });
      }
      const outsider = await t.loginOnboarded();
      expect((await api.saveAttendance(outsider.token, lobby.id, [])).statusCode).toBe(403);
      expect((await memberRow(members[0]!.applicationId)).status).toBe('approved');
    });

    it('saves once: karma for members and the host, results to members', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -150 });
      const [came, absent, checkedIn] = members;
      await checkIn(checkedIn!.applicationId);
      const before = await karmaOf(host.user.id);

      const view = attendanceResponse.parse((await api.attendance(host.token, lobby.id)).json());
      expect(view.state).toBe('open');
      expect(view.deadline).toBe(new Date(lobby.endsAt.getTime() + 48 * HOUR_MS).toISOString());
      expect(view.members.map((m) => m.applicationId)).toEqual(members.map((m) => m.applicationId));
      expect(view.members[2]!.checkedInAt).toEqual(expect.any(String));

      const lockedOut = await api.saveAttendance(host.token, lobby.id, [checkedIn!.applicationId]);
      expect(lockedOut.statusCode).toBe(400);
      expect(lockedOut.json()).toMatchObject({ code: 'checked_in_member' });
      const pending = await t.loginOnboarded();
      const pendingRow = await setMembership(t.db, lobby.id, pending.user.id, 'pending');
      for (const foreign of [pendingRow.id, crypto.randomUUID()]) {
        expect((await api.saveAttendance(host.token, lobby.id, [foreign])).json()).toMatchObject({
          code: 'invalid_data',
        });
      }

      const saved = await api.saveAttendance(host.token, lobby.id, [absent!.applicationId]);
      expect(saved.statusCode).toBe(200);
      const body: AttendanceResponse = attendanceResponse.parse(saved.json());
      expect(body.state).toBe('saved');
      expect(body.members.map((m) => [m.status, m.absent])).toEqual([
        ['attended', false],
        ['no_show', true],
        ['attended', false],
      ]);
      expect((await karmaEventsOf(t.db, came!.user.id, lobby.id)).map((e) => e.delta)).toEqual([
        KARMA.ATTENDED,
      ]);
      expect((await karmaEventsOf(t.db, absent!.user.id, lobby.id)).map((e) => e.delta)).toEqual([
        KARMA.NO_SHOW,
      ]);
      expect(await karmaOf(host.user.id)).toBe(before + KARMA.HOSTED);
      expect((await karmaEventsOf(t.db, host.user.id, lobby.id)).map((e) => e.reason)).toEqual(['hosted']);

      const repeat = await api.saveAttendance(host.token, lobby.id, []);
      expect(repeat.statusCode).toBe(409);
      expect(repeat.json()).toMatchObject({ code: 'attendance_saved' });
      expect(await karmaEventsOf(t.db, came!.user.id, lobby.id)).toHaveLength(1);

      expect(await queued(lobby.id, 'member_attendance_result')).toHaveLength(3);
      await t.flushOutbox();
      expect(t.telegram.textsTo(came!.user.telegramId)).toEqual([
        `По отметке хоста вы были на «Настолки». Карма +${KARMA.ATTENDED}.`,
      ]);
      expect(t.telegram.textsTo(absent!.user.telegramId)[0]).toMatch(/^По отметке хоста вас не было/);

      const detail = lobbyDetailDto.parse((await api.detail(host.token, lobby.id)).json());
      expect(detail.attendance?.state).toBe('saved');
    });

    it("lists the lobby in the host's «Мои» until the marks are saved", async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -150 });
      const empty = await meetup({ startsInMin: -150, members: 0 });
      const due = async (token: string) =>
        myLobbiesResponse.parse(
          (await t.app.inject({ method: 'GET', url: '/api/me/lobbies', headers: authHeader(token) })).json(),
        ).attendanceDue;
      expect(await due(host.token)).toEqual([lobby.id]);
      expect(await due(empty.host.token)).toEqual([]);
      expect(await due(members[0]!.token)).toEqual([]);
      await api.saveAttendance(host.token, lobby.id, []);
      expect(await due(host.token)).toEqual([]);
    });

    it('gives the host nothing when nobody came; parallel saves count once', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -150 });
      const ids = members.map((m) => m.applicationId);
      const responses = await Promise.all([1, 2, 3].map(() => api.saveAttendance(host.token, lobby.id, ids)));
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
      expect(await karmaEventsOf(t.db, host.user.id, lobby.id)).toEqual([]);
      for (const member of members) {
        expect((await karmaEventsOf(t.db, member.user.id, lobby.id)).map((e) => e.delta)).toEqual([
          KARMA.NO_SHOW,
        ]);
      }
    });
  });

  describe('the bot after the meetup', () => {
    it('asks the host and the members once, two hours after the end', async () => {
      const soon = await meetup({ startsInMin: -150 });
      await sweeper.sweep();
      expect(await queued(soon.lobby.id, 'host_attendance_poll')).toEqual([]);

      const { host, lobby, members } = await meetup({ startsInMin: -250 });
      const left = await t.loginOnboarded();
      await setMembership(t.db, lobby.id, left.user.id, 'cancelled', { decided: true });
      await sweeper.sweep();
      await sweeper.sweep();
      expect(await queued(lobby.id, 'host_attendance_poll')).toHaveLength(1);
      const asked = (await queued(lobby.id, 'member_feedback_request')).map((n) => n.userId).sort();
      expect(asked).toEqual(members.map((m) => m.user.id).sort());
      expect(await queued(lobby.id, 'host_attendance_reminder')).toEqual([]);

      await t.flushOutbox();
      const [poll] = t.telegram.sent('sendMessage', host.user.telegramId);
      expect(String(poll!.payload.text)).toMatch(/^Как прошла «Настолки»\?/);
      const rows = (poll!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
      expect(rows.map((row) => row[0]!.text)).toEqual([
        '✓ на встрече · Тест',
        '✓ на встрече · Тест',
        '✓ на встрече · Тест',
        'Сохранить: на встрече 3, не было 0',
        'Открыть список',
      ]);
      expect(t.telegram.textsTo(members[0]!.user.telegramId)).toEqual([
        'Как прошла встреча «Настолки» от Тест?',
      ]);
    });

    it('toggles and saves from the poll, for the host only', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -150 });
      const [absent, , checkedIn] = members;
      await checkIn(checkedIn!.applicationId);

      // Someone else's tap (a forwarded poll) changes nothing.
      await tap(absent!.user.telegramId, `a:t:${absent!.applicationId}`);
      expect(answers()).toEqual(['Управлять встречей может только хост']);
      expect((await memberRow(absent!.applicationId)).attendanceAbsentDraft).toBe(false);

      t.telegram.reset();
      await tap(host.user.telegramId, `a:t:${absent!.applicationId}`);
      expect((await memberRow(absent!.applicationId)).attendanceAbsentDraft).toBe(true);
      const [edit] = t.telegram.sent('editMessageReplyMarkup');
      const rows = (edit!.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
      expect(rows[0]![0]!.text).toBe('✗ не было · Тест');
      expect(rows[2]![0]!.text).toBe('✓ на встрече · Тест · на месте');
      expect(rows[3]![0]!.text).toBe('Сохранить: на встрече 2, не было 1');

      await tap(host.user.telegramId, `a:t:${checkedIn!.applicationId}`);
      expect(answers().at(-1)).toBe('Отметка «Я на месте» есть, изменить нельзя');
      expect((await memberRow(checkedIn!.applicationId)).attendanceAbsentDraft).toBe(false);

      await tap(host.user.telegramId, `a:s:${lobby.id}`, 'Как прошла «Настолки»?');
      expect(answers().at(-1)).toBe('Сохранено: на встрече 2, не было 1. Карма начислена.');
      expect((await memberRow(absent!.applicationId)).status).toBe('no_show');
      expect((await memberRow(checkedIn!.applicationId)).status).toBe('attended');
      expect((await karmaEventsOf(t.db, host.user.id, lobby.id)).map((e) => e.reason)).toEqual(['hosted']);

      await tap(host.user.telegramId, `a:s:${lobby.id}`);
      expect(answers().at(-1)).toBe('Вы уже отметили, кто пришёл');
      await tap(host.user.telegramId, `a:t:${absent!.applicationId}`);
      expect(answers().at(-1)).toBe('Вы уже отметили, кто пришёл');
      expect(await karmaEventsOf(t.db, absent!.user.id, lobby.id)).toHaveLength(1);
    });

    it('reminds a silent host after a day', async () => {
      const { host, lobby } = await meetup({ startsInMin: -26 * 60 });
      const saved = await meetup({ startsInMin: -26 * 60 });
      await api.saveAttendance(saved.host.token, saved.lobby.id, []);
      await sweeper.sweep();
      await sweeper.sweep();
      expect(await queued(lobby.id, 'host_attendance_reminder')).toHaveLength(1);
      expect(await queued(saved.lobby.id, 'host_attendance_reminder')).toEqual([]);
      await t.flushOutbox();
      // The poll was due too (both steps ran in one pass), so the host gets both.
      expect(t.telegram.textsTo(host.user.telegramId)).toContainEqual(
        expect.stringMatching(/^Отметьте, кто пришёл на «Настолки», до /),
      );
    });

    it('closes after two days: checked-in members attend, the host gets nothing, the bot leaves', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -51 * 60 });
      const [checkedIn, silent] = members;
      await checkIn(checkedIn!.applicationId, 50 * 60);
      const chatId = freshChatId();
      await linkChat(t.db, lobby.id, chatId);
      await sweeper.sweep();

      const row = await lobbyRow(lobby.id);
      expect(row.attendanceClosedAt).not.toBeNull();
      expect(row.chatClosedAt).not.toBeNull();
      expect((await memberRow(checkedIn!.applicationId)).status).toBe('attended');
      expect((await memberRow(silent!.applicationId)).status).toBe('approved');
      expect((await karmaEventsOf(t.db, checkedIn!.user.id, lobby.id)).map((e) => e.delta)).toEqual([
        KARMA.ATTENDED,
      ]);
      expect(await karmaEventsOf(t.db, silent!.user.id, lobby.id)).toEqual([]);
      expect(await karmaEventsOf(t.db, host.user.id, lobby.id)).toEqual([]);

      await t.flushOutbox();
      expect(t.telegram.textsTo(checkedIn!.user.telegramId)).toEqual([
        `Вы отметились на месте на «Настолки». Карма +${KARMA.ATTENDED}.`,
      ]);
      // Asked and closed in one pass: the stale poll and feedback requests are dropped.
      expect(t.telegram.textsTo(host.user.telegramId)).toEqual([]);
      expect(t.telegram.textsTo(silent!.user.telegramId)).toEqual([]);
      expect(t.telegram.sent('leaveChat', chatId)).toHaveLength(1);

      expect((await api.saveAttendance(host.token, lobby.id, [])).json()).toMatchObject({
        code: 'attendance_closed',
      });
      await sweeper.sweep();
      expect(await karmaEventsOf(t.db, checkedIn!.user.id, lobby.id)).toHaveLength(1);
    });

    it('records one feedback answer per member who took part', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -150 });
      const [rater, absent] = members;
      await api.saveAttendance(host.token, lobby.id, [absent!.applicationId]);

      await tap(rater!.user.telegramId, `f:good:${lobby.id}`, 'Как прошла встреча?');
      await tap(rater!.user.telegramId, `f:bad:${lobby.id}`);
      await tap(absent!.user.telegramId, `f:bad:${lobby.id}`);
      await tap(host.user.telegramId, `f:good:${lobby.id}`);
      expect(answers()).toEqual(['Спасибо!', 'Уже записали', 'Это уже неактуально.', 'Это уже неактуально.']);
      const rows = await t.db.select().from(lobbyFeedback).where(eq(lobbyFeedback.lobbyId, lobby.id));
      expect(rows.map((r) => [r.userId, r.rating])).toEqual([[rater!.user.id, 'good']]);
      const [edit] = t.telegram.sent('editMessageText');
      expect(edit!.payload.text).toBe('Как прошла встреча?\n\nСпасибо!');
      expect(edit!.payload.reply_markup).toBeUndefined();
    });

    it('«Не состоялась» opens one moderation case per lobby; later answers join it', async () => {
      const { host, lobby, members } = await meetup({ startsInMin: -150 });
      const [first, second, happy] = members;
      await tap(happy!.user.telegramId, `f:good:${lobby.id}`);
      const casesOf = () => t.db.select().from(moderationCases).where(eq(moderationCases.lobbyId, lobby.id));
      expect(await casesOf()).toEqual([]);

      await Promise.all([
        tap(first!.user.telegramId, `f:not_held:${lobby.id}`),
        tap(second!.user.telegramId, `f:not_held:${lobby.id}`),
      ]);
      expect(await casesOf()).toEqual([
        expect.objectContaining({ kind: 'not_held', subjectId: host.user.id, resolvedAt: null }),
      ]);
    });
  });
});
