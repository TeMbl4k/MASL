import { eq } from 'drizzle-orm';
import { lobbies, lobbyChatRequests, lobbyMembers } from '@masl/db';
import { apiErrorDto, chatPrepareResponse, lobbyDetailDto, type ApiErrorCode } from '@masl/shared';
import { FAKE_BOT } from './fake-telegram.js';
import {
  adminUrl,
  bootApp,
  freshChatId,
  insertLobby,
  linkChat,
  lobbyApi,
  makeOutboxDue,
  setMembership,
  shiftLobby,
  type InjectResponse,
  type TestApp,
} from './helpers.js';

describe.skipIf(!adminUrl)('meetup chat e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  let api: ReturnType<typeof lobbyApi>;

  beforeAll(async () => {
    t = await bootApp();
    api = lobbyApi(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    t.telegram.reset();
  });

  const expectError = (response: InjectResponse, status: number, code: ApiErrorCode) => {
    expect(response.statusCode, response.body).toBe(status);
    expect(apiErrorDto.parse(response.json()).code).toBe(code);
  };
  const user = (id: number) => ({ id, is_bot: false, first_name: 'Тест' });
  const lobbyRow = async (id: string) => (await t.db.select().from(lobbies).where(eq(lobbies.id, id)))[0]!;

  /** A host's lobby with one approved and one pending member. */
  async function fixture() {
    const host = await t.loginOnboarded();
    const approved = await t.loginOnboarded();
    const pending = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Падел' });
    const approvedRow = await setMembership(t.db, lobby.id, approved.user.id, 'approved');
    await setMembership(t.db, lobby.id, pending.user.id, 'pending');
    return { host, approved, approvedRow, pending, lobby };
  }

  /** «Создать чат встречи» through the app; returns the request_id given to Telegram. */
  async function prepare(token: string, lobbyId: string): Promise<number> {
    const response = await api.prepareChat(token, lobbyId);
    expect(response.statusCode, response.body).toBe(200);
    expect(chatPrepareResponse.parse(response.json()).preparedButtonId).toMatch(/^prepared-/);
    const call = t.telegram.sent('savePreparedKeyboardButton').at(-1)!;
    return (call.payload.button as { request_chat: { request_id: number } }).request_chat.request_id;
  }

  const chatShared = (fromId: number, requestId: number, chatId: number, title = 'Падел: чат') =>
    t.handleUpdate({
      message: {
        message_id: 1,
        date: 0,
        chat: { id: fromId, type: 'private', first_name: 'Тест' },
        from: user(fromId),
        chat_shared: { request_id: requestId, chat_id: chatId, title },
      },
    });
  const lastReply = (telegramId: number) => t.telegram.textsTo(telegramId).at(-1);
  const joinRequest = (chatId: number, telegramId: number) =>
    t.handleUpdate({
      chat_join_request: {
        chat: { id: chatId, type: 'supergroup', title: 'Чат' },
        from: user(telegramId),
        user_chat_id: telegramId,
        date: 0,
      },
    });

  describe('POST /lobbies/:id/chat/prepare', () => {
    it('gives the host a prepared request_chat button asking the bot rights', async () => {
      const { host, lobby } = await fixture();
      await prepare(host.token, lobby.id);
      const [call] = t.telegram.sent('savePreparedKeyboardButton');
      expect(call?.payload).toMatchObject({
        user_id: host.user.telegramId,
        button: {
          request_chat: {
            chat_is_channel: false,
            bot_is_member: true,
            bot_administrator_rights: { can_invite_users: true, can_restrict_members: true },
          },
        },
      });
    });

    it('sends the picker in the bot chat when asked', async () => {
      const { host, lobby } = await fixture();
      const response = await api.prepareChat(host.token, lobby.id, { via: 'bot' });
      expect(response.json()).toEqual({ preparedButtonId: null });
      const [call] = t.telegram.sent('sendMessage', host.user.telegramId);
      expect(call?.payload.reply_markup).toMatchObject({
        keyboard: [[{ request_chat: { bot_is_member: true } }]],
        one_time_keyboard: true,
      });
    });

    it('is the host’s only, for an open or active lobby without a group', async () => {
      const { host, approved, lobby } = await fixture();
      expectError(await api.prepareChat(approved.token, lobby.id), 403, 'not_host');
      expectError(await api.prepareChat(host.token, crypto.randomUUID()), 404, 'lobby_not_found');

      const finished = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -180, durationMin: 60 });
      expectError(await api.prepareChat(host.token, finished.id), 409, 'lobby_closed');
      const cancelled = await insertLobby(t.db, { hostId: host.user.id, status: 'cancelled' });
      expectError(await api.prepareChat(host.token, cancelled.id), 409, 'lobby_cancelled');

      await linkChat(t.db, lobby.id, freshChatId());
      expectError(await api.prepareChat(host.token, lobby.id), 409, 'chat_already_linked');
      expect(t.telegram.sent('savePreparedKeyboardButton')).toEqual([]);
    });

    it('answers 503 when Telegram refuses', async () => {
      const { host, lobby } = await fixture();
      t.telegram.fail('savePreparedKeyboardButton', { error_code: 400, description: 'Bad Request' });
      expectError(await api.prepareChat(host.token, lobby.id), 503, 'bot_unavailable');
    });
  });

  describe('linking the picked group', () => {
    it('links the group, invites approved members and greets the group', async () => {
      const { host, approved, pending, lobby } = await fixture();
      const requestId = await prepare(host.token, lobby.id);
      const chatId = freshChatId();
      await chatShared(host.user.telegramId, requestId, chatId);

      expect(lastReply(host.user.telegramId)).toBe(
        'Чат подключён к «Падел». Бот пустит в группу только одобренных участников и разошлёт им ссылку.',
      );
      const row = await lobbyRow(lobby.id);
      expect(row).toMatchObject({ chatId, chatTitle: 'Падел: чат', chatClosedAt: null });
      expect(row.chatInviteLink).toMatch(/^https:\/\/t\.me\/\+fake/);
      expect(t.telegram.sent('createChatInviteLink')[0]?.payload).toMatchObject({
        chat_id: chatId,
        creates_join_request: true,
        expire_date: Math.floor(lobby.endsAt.getTime() / 1000),
      });
      expect(t.telegram.sent('getChatMember')[0]?.payload).toMatchObject({
        chat_id: chatId,
        user_id: FAKE_BOT.id,
      });

      await t.flushOutbox();
      expect(t.telegram.textsTo(chatId)[0]).toContain('Это чат встречи «Падел»');
      expect(JSON.stringify(t.telegram.sent('sendMessage', chatId))).not.toContain('CANARY');
      const [invite] = t.telegram.sent('sendMessage', approved.user.telegramId);
      expect(invite?.payload.reply_markup).toEqual({
        inline_keyboard: [[{ text: 'Вступить в чат', url: row.chatInviteLink }]],
      });
      expect(t.telegram.textsTo(pending.user.telegramId)).toEqual([]);

      const hostView = lobbyDetailDto.parse((await api.detail(host.token, lobby.id)).json());
      expect(hostView.chat).toEqual({ state: 'linked', title: 'Падел: чат', inviteLink: row.chatInviteLink });
      const memberView = lobbyDetailDto.parse((await api.detail(approved.token, lobby.id)).json());
      expect(memberView.chat?.inviteLink).toBe(row.chatInviteLink);
      const pendingView = lobbyDetailDto.parse((await api.detail(pending.token, lobby.id)).json());
      expect(pendingView.chat).toBeNull();
    });

    it('warns the host when the group already has people', async () => {
      const { host, lobby } = await fixture();
      const requestId = await prepare(host.token, lobby.id);
      t.telegram.respond('getChatMemberCount', 7);
      await chatShared(host.user.telegramId, requestId, freshChatId());
      expect(lastReply(host.user.telegramId)).toContain('В группе уже есть люди');
    });

    it('refuses a request of another user, an old or used one, and a taken group', async () => {
      const { host, approved, lobby } = await fixture();
      const requestId = await prepare(host.token, lobby.id);
      const stale = 'Ссылка устарела. Нажмите «Создать чат встречи» в приложении ещё раз.';

      // Another user forwarding the button or replaying the request id.
      await chatShared(approved.user.telegramId, requestId, freshChatId());
      expect(lastReply(approved.user.telegramId)).toBe(stale);
      expect((await lobbyRow(lobby.id)).chatId).toBeNull();

      await t.db
        .update(lobbyChatRequests)
        .set({ createdAt: new Date(Date.now() - 31 * 60_000) })
        .where(eq(lobbyChatRequests.id, requestId));
      await chatShared(host.user.telegramId, requestId, freshChatId());
      expect(lastReply(host.user.telegramId)).toBe(stale);

      const fresh = await prepare(host.token, lobby.id);
      const chatId = freshChatId();
      await chatShared(host.user.telegramId, fresh, chatId);
      await chatShared(host.user.telegramId, fresh, freshChatId());
      expect(lastReply(host.user.telegramId)).toBe(stale);
      expect((await lobbyRow(lobby.id)).chatId).toBe(chatId);

      const other = await insertLobby(t.db, { hostId: host.user.id });
      const otherRequest = await prepare(host.token, other.id);
      await chatShared(host.user.telegramId, otherRequest, chatId);
      expect(lastReply(host.user.telegramId)).toBe(
        'Эта группа уже подключена к другой встрече. Создайте новую группу.',
      );
      expect((await lobbyRow(other.id)).chatId).toBeNull();
    });

    it('asks for the missing admin rights', async () => {
      const { host, lobby } = await fixture();
      const requestId = await prepare(host.token, lobby.id);
      t.telegram.respond('getChatMember', { status: 'member', user: FAKE_BOT });
      await chatShared(host.user.telegramId, requestId, freshChatId());
      expect(lastReply(host.user.telegramId)).toBe(
        'Боту нужны права администратора в группе: приглашать участников, блокировать участников. Выдайте их и нажмите «Создать чат встречи» ещё раз.',
      );
      expect((await lobbyRow(lobby.id)).chatId).toBeNull();
      expect(t.telegram.sent('createChatInviteLink')).toEqual([]);
    });
  });

  describe('join requests', () => {
    it('admits only approved members of an ongoing lobby', async () => {
      const { host, approved, approvedRow, pending, lobby } = await fixture();
      const chatId = freshChatId();
      await linkChat(t.db, lobby.id, chatId);
      const rejected = await t.loginOnboarded();
      await setMembership(t.db, lobby.id, rejected.user.id, 'rejected');
      const left = await t.loginOnboarded();
      await setMembership(t.db, lobby.id, left.user.id, 'cancelled', { decided: true });
      const stranger = await t.loginOnboarded();

      for (const u of [approved, pending, rejected, left, stranger, host]) {
        await joinRequest(chatId, u.user.telegramId);
      }
      expect(t.telegram.sent('approveChatJoinRequest').map((c) => c.payload.user_id)).toEqual([
        approved.user.telegramId,
      ]);
      expect(t.telegram.sent('declineChatJoinRequest').map((c) => c.payload.user_id)).toEqual(
        [pending, rejected, left, stranger, host].map((u) => u.user.telegramId),
      );
      const [member] = await t.db.select().from(lobbyMembers).where(eq(lobbyMembers.id, approvedRow.id));
      expect(member?.chatJoinedAt).toBeInstanceOf(Date);

      // Not after the end, and not for a group the lobby no longer uses.
      t.telegram.reset();
      await shiftLobby(t.db, lobby.id, { startsInMin: -180, durationMin: 60 });
      await joinRequest(chatId, approved.user.telegramId);
      expect(t.telegram.sent('declineChatJoinRequest')).toHaveLength(1);
    });
  });

  describe('group changes', () => {
    it('frees the lobby when the bot is removed, so the host can link another group', async () => {
      const { host, lobby } = await fixture();
      const chatId = freshChatId();
      await linkChat(t.db, lobby.id, chatId);
      await t.handleUpdate({
        my_chat_member: {
          chat: { id: chatId, type: 'supergroup', title: 'Чат' },
          from: user(host.user.telegramId),
          date: 0,
          old_chat_member: { status: 'administrator', user: FAKE_BOT } as never,
          new_chat_member: { status: 'kicked', user: FAKE_BOT, until_date: 0 },
        },
      });
      expect((await lobbyRow(lobby.id)).chatClosedAt).toBeInstanceOf(Date);
      const detail = lobbyDetailDto.parse((await api.detail(host.token, lobby.id)).json());
      expect(detail.chat).toEqual({ state: 'none', title: null, inviteLink: null });
      expect((await api.prepareChat(host.token, lobby.id)).statusCode).toBe(200);
    });

    it('tells the host when the bot loses rights', async () => {
      const { host, lobby } = await fixture();
      const chatId = freshChatId();
      await linkChat(t.db, lobby.id, chatId);
      await t.handleUpdate({
        my_chat_member: {
          chat: { id: chatId, type: 'supergroup', title: 'Чат' },
          from: user(host.user.telegramId),
          date: 0,
          old_chat_member: { status: 'administrator', user: FAKE_BOT } as never,
          new_chat_member: { status: 'member', user: FAKE_BOT },
        },
      });
      expect(lastReply(host.user.telegramId)).toContain('у бота нет прав: приглашать участников');
    });

    it('follows a group upgraded to a supergroup', async () => {
      const { approved, lobby } = await fixture();
      const oldId = freshChatId();
      const newId = freshChatId();
      await linkChat(t.db, lobby.id, oldId);
      await t.handleUpdate({
        message: {
          message_id: 5,
          date: 0,
          chat: { id: oldId, type: 'group', title: 'Чат' },
          from: user(approved.user.telegramId),
          migrate_to_chat_id: newId,
        },
      });
      const row = await lobbyRow(lobby.id);
      expect(row.chatId).toBe(newId);
      expect(t.telegram.sent('createChatInviteLink')[0]?.payload.chat_id).toBe(newId);
      await makeOutboxDue(t.db);
      await t.flushOutbox();
      const [invite] = t.telegram.sent('sendMessage', approved.user.telegramId);
      expect(JSON.stringify(invite?.payload.reply_markup)).toContain(row.chatInviteLink!);
    });
  });

  it('hides the group from members after the end', async () => {
    const { approved, lobby } = await fixture();
    const chatId = freshChatId();
    await linkChat(t.db, lobby.id, chatId);
    await shiftLobby(t.db, lobby.id, { startsInMin: -180, durationMin: 60 });
    const detail = lobbyDetailDto.parse((await api.detail(approved.token, lobby.id)).json());
    expect(detail.chat).toBeNull();
  });
});
