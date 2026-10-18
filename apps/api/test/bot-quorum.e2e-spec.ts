import { and, eq } from 'drizzle-orm';
import { lobbies, notifications, users } from '@masl/db';
import { KARMA, cancelLobbyResponse, creationContextDto } from '@masl/shared';
import { LobbyStatusSweeper } from '../src/lobbies/lobby-status.sweeper.js';
import {
  adminUrl,
  authHeader,
  bootApp,
  freshChatId,
  insertLobby,
  karmaEventsOf,
  linkChat,
  lobbyApi,
  makeOutboxDue,
  setMembership,
  type TestApp,
} from './helpers.js';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

describe.skipIf(!adminUrl)('quorum check and host late cancel e2e (requires TEST_DATABASE_URL)', () => {
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
  const tap = (telegramId: number, data: string) =>
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
          text: 'Проверка кворума',
        },
      },
    });
  const answers = () => t.telegram.sent('answerCallbackQuery').map((c) => c.payload.text);

  /** A lobby starting in 50 minutes, created 3 hours ago, with `approved` of 3 places taken. */
  async function soonLobby(approved: number, minKarma: number | null = 60) {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, {
      hostId: host.user.id,
      now: new Date(Date.now() - 3 * HOUR_MS),
      startsInMin: 3 * 60 + 50,
      slots: 3,
      minKarma,
      title: 'Бег',
    });
    const members = [];
    for (let i = 0; i < approved; i++) {
      const member = await t.loginOnboarded();
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      members.push(member);
    }
    return { host, lobby, members };
  }

  describe('the quorum check', () => {
    it('asks the host of a lobby that is not full, once', async () => {
      const { host, lobby } = await soonLobby(1);
      await sweeper.sweep();
      await sweeper.sweep();
      expect(await queued(lobby.id, 'host_quorum_check')).toHaveLength(1);
      await t.flushOutbox();
      const [call] = t.telegram.sent('sendMessage', host.user.telegramId);
      expect(String(call!.payload.text)).toContain('Занято 1 из 3');
      const buttons = (
        call!.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }
      ).inline_keyboard;
      expect(buttons.map((row) => row[0]!.text)).toEqual([
        'Снизить порог кармы до 50',
        'Отменить встречу',
        'Проводим как есть',
      ]);
    });

    it('does not ask about a full lobby, a lobby created within the hour or one already started', async () => {
      const full = await soonLobby(3);
      const host = await t.loginOnboarded();
      const late = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 40 });
      const started = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -10 });
      await sweeper.sweep();
      for (const id of [full.lobby.id, late.id, started.id]) {
        expect(await queued(id, 'host_quorum_check')).toEqual([]);
        expect((await lobbyRow(id)).quorumCheckedAt).toBeInstanceOf(Date);
      }
    });

    it('lets the host lower the threshold step by step from the bot', async () => {
      const { host, lobby } = await soonLobby(1, 50);
      await tap(host.user.telegramId, `q:lower:${lobby.id}`);
      expect((await lobbyRow(lobby.id)).minKarma).toBe(40);
      await tap(host.user.telegramId, `q:lower:${lobby.id}`);
      expect((await lobbyRow(lobby.id)).minKarma).toBeNull();
      expect(answers()).toEqual([
        'Готово: порог кармы теперь 40.',
        'Готово: порога кармы больше нет, подать заявку может любой.',
      ]);
      const [edit] = t.telegram.sent('editMessageText');
      expect(String(edit?.payload.text)).toContain('Готово: порог кармы теперь 40.');
    });

    it('refuses taps of anyone but the host and of strangers to the app', async () => {
      const { lobby, members } = await soonLobby(1, 70);
      await tap(members[0]!.user.telegramId, `q:lower:${lobby.id}`);
      await tap(members[0]!.user.telegramId, `q:cancel!:${lobby.id}`);
      await tap(123_456, `q:lower:${lobby.id}`);
      await tap(members[0]!.user.telegramId, 'q:lower:not-a-lobby');
      expect(answers()).toEqual([
        'Управлять встречей может только хост',
        'Управлять встречей может только хост',
        'Откройте приложение, чтобы войти',
        'Это уже неактуально.',
      ]);
      const row = await lobbyRow(lobby.id);
      expect(row).toMatchObject({ minKarma: 70, status: 'open' });
    });

    it('cancels from the bot after a confirmation, without a penalty while not full', async () => {
      const { host, lobby, members } = await soonLobby(1);
      await tap(host.user.telegramId, `q:cancel:${lobby.id}`);
      expect((await lobbyRow(lobby.id)).status).toBe('open');
      const [confirm] = t.telegram.sent('editMessageText');
      expect(confirm?.payload.text).toBe('Отменить «Бег»? Сейчас без штрафа.');

      await tap(host.user.telegramId, `q:cancel!:${lobby.id}`);
      expect(await lobbyRow(lobby.id)).toMatchObject({
        status: 'cancelled',
        cancelReason: 'not_enough_people',
      });
      expect(await karmaEventsOf(t.db, host.user.id)).toEqual([]);
      await t.flushOutbox();
      expect(t.telegram.textsTo(members[0]!.user.telegramId)[0]).toContain('Встречу «Бег»');

      // A stale tap afterwards changes nothing.
      await tap(host.user.telegramId, `q:lower:${lobby.id}`);
      expect(answers().at(-1)).toBe('Встреча отменена');
    });
  });

  describe('host late cancel', () => {
    const creationReason = async (token: string) =>
      creationContextDto.parse(
        (
          await t.app.inject({
            method: 'GET',
            url: '/api/lobbies/creation-context',
            headers: authHeader(token),
          })
        ).json(),
      ).reason;

    it('costs karma and blocks creation for a full lobby within the last hour, whatever the reason', async () => {
      const { host, lobby } = await soonLobby(3);
      const response = await api.cancel(host.token, lobby.id, { reason: 'not_enough_people', comment: null });
      expect(response.statusCode, response.body).toBe(200);
      expect(cancelLobbyResponse.parse(response.json()).karmaDelta).toBe(KARMA.HOST_LATE_CANCEL);
      const [user] = await t.db.select().from(users).where(eq(users.id, host.user.id));
      expect(user).toMatchObject({ karma: KARMA.START + KARMA.HOST_LATE_CANCEL, lobbyCreationBlocked: true });
      expect((await karmaEventsOf(t.db, host.user.id)).map((e) => e.reason)).toEqual(['host_late_cancel']);
      expect(await creationReason(host.token)).toBe('blocked');

      const repeat = await api.cancel(host.token, lobby.id);
      expect(repeat.json()).toMatchObject({ karmaDelta: 0 });
      expect(await karmaEventsOf(t.db, host.user.id)).toHaveLength(1);
    });

    it('is free earlier, or when places are left', async () => {
      const early = await t.loginOnboarded();
      const earlyLobby = await insertLobby(t.db, { hostId: early.user.id, startsInMin: 61, slots: 1 });
      const member = await t.loginOnboarded();
      await setMembership(t.db, earlyLobby.id, member.user.id, 'approved');
      expect((await api.cancel(early.token, earlyLobby.id)).json()).toMatchObject({ karmaDelta: 0 });

      const { host, lobby } = await soonLobby(2);
      expect((await api.cancel(host.token, lobby.id)).json()).toMatchObject({ karmaDelta: 0 });
      for (const who of [early, host]) {
        expect(await creationReason(who.token)).not.toBe('blocked');
        expect(await karmaEventsOf(t.db, who.user.id)).toEqual([]);
      }
    });

    it('shows the host when a cancel becomes late', async () => {
      const { host, lobby } = await soonLobby(3);
      const detail = (await api.detail(host.token, lobby.id)).json();
      expect(detail.cancelPolicy).toEqual({
        lateFrom: new Date(lobby.startsAt.getTime() - HOUR_MS).toISOString(),
        quorumMet: true,
      });
      const member = (await api.detail((await t.loginOnboarded()).token, lobby.id)).json();
      expect(member.cancelPolicy).toBeNull();
    });
  });

  describe('the group at the end', () => {
    it('revokes the link and says goodbye when the lobby ends', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -130, title: 'Квиз' });
      const chatId = freshChatId();
      const link = await linkChat(t.db, lobby.id, chatId);
      await sweeper.sweep();
      await sweeper.sweep();
      await t.flushOutbox();
      expect(t.telegram.sent('revokeChatInviteLink', chatId).map((c) => c.payload.invite_link)).toEqual([
        link,
      ]);
      expect(t.telegram.textsTo(chatId)).toEqual([
        'Встреча «Квиз» закончилась. Спасибо, что пришли! Ссылка-приглашение больше не работает, бот выйдет из группы через 2 дня.',
      ]);
    });

    it('leaves the group of a lobby cancelled two days ago', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, status: 'cancelled' });
      const chatId = freshChatId();
      await linkChat(t.db, lobby.id, chatId);
      await sweeper.sweep();
      expect((await lobbyRow(lobby.id)).chatClosedAt).toBeNull();
      await t.db
        .update(lobbies)
        .set({ cancelledAt: new Date(Date.now() - 49 * HOUR_MS) })
        .where(eq(lobbies.id, lobby.id));
      await sweeper.sweep();
      await makeOutboxDue(t.db);
      await t.flushOutbox();
      expect(t.telegram.sent('leaveChat', chatId)).toHaveLength(1);
      expect((await lobbyRow(lobby.id)).chatClosedAt).toBeInstanceOf(Date);
    });
  });

  it('keeps the minute arithmetic honest', () => {
    expect(MINUTE_MS * 60).toBe(HOUR_MS);
  });
});
