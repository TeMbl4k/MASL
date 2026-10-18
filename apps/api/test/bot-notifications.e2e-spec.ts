import { eq } from 'drizzle-orm';
import { lobbyMembers, notifications } from '@masl/db';
import {
  CANARY_ADDRESS,
  CANARY_POINT,
  adminUrl,
  applicationIdOf,
  bootApp,
  freshChatId,
  insertLobby,
  linkChat,
  lobbyApi,
  makeOutboxDue,
  setMembership,
  setUser,
  type TestApp,
} from './helpers.js';

describe.skipIf(!adminUrl)('bot notifications e2e (requires TEST_DATABASE_URL)', () => {
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

  const send = async () => {
    await makeOutboxDue(t.db);
    await t.flushOutbox();
  };
  /** Every text and venue the bot sent, for leak checks. */
  const everything = () => JSON.stringify(t.telegram.calls.map((c) => c.payload));

  it('collects close applications into one message to the host, without hidden applicants', async () => {
    const host = await t.loginOnboarded(undefined, 'Анна');
    const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Падел', slots: 4 });
    const [maria, dmitry, banned] = await Promise.all([
      t.loginOnboarded(undefined, 'Мария'),
      t.loginOnboarded(undefined, 'Дмитрий'),
      t.loginOnboarded(undefined, 'Скрытый'),
    ]);
    await setUser(t.db, banned!.user.id, { isShadowBanned: true });
    for (const user of [maria!, dmitry!, banned!]) {
      expect((await api.apply(user.token, lobby.id)).statusCode).toBe(201);
    }
    const pending = await t.db.select().from(notifications).where(eq(notifications.lobbyId, lobby.id));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.sendAfter.getTime() - Date.now()).toBeGreaterThan(50_000);

    await t.flushOutbox();
    expect(t.telegram.textsTo(host.user.telegramId)).toEqual([]);
    await send();
    const [text] = t.telegram.textsTo(host.user.telegramId);
    expect(text).toContain('Новые заявки на «Падел»:');
    expect(text).toContain('Мария · карма 50 · новичок');
    expect(text).toContain('Дмитрий · карма 50 · новичок');
    expect(text).toContain('Занято 0 из 4.');
    expect(text).not.toContain('Скрытый');
    const [call] = t.telegram.sent('sendMessage', host.user.telegramId);
    expect(call?.payload.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: 'Открыть заявки', web_app: { url: `https://masl.example/lobby/${lobby.id}/manage` } }],
      ],
    });

    t.telegram.reset();
    const late = await t.loginOnboarded(undefined, 'Ирина');
    await api.apply(late.token, lobby.id);
    await send();
    const [second] = t.telegram.textsTo(host.user.telegramId);
    expect(second).toContain('Ирина');
    expect(second).not.toContain('Мария');
  });

  it('sends the exact address only to the approved member, with a venue', async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Настолки' });
    const approved = await t.loginOnboarded();
    const rejected = await t.loginOnboarded();
    for (const user of [approved, rejected]) await api.apply(user.token, lobby.id);
    const approve = await api.decide(
      host.token,
      lobby.id,
      await applicationIdOf(t.db, lobby.id, approved.user.id),
      'approve',
    );
    expect(approve.statusCode).toBe(200);
    await api.decide(host.token, lobby.id, await applicationIdOf(t.db, lobby.id, rejected.user.id), 'reject');
    // A repeated decision changes nothing and sends nothing.
    await api.decide(
      host.token,
      lobby.id,
      await applicationIdOf(t.db, lobby.id, approved.user.id),
      'approve',
    );
    t.telegram.reset();
    await send();

    const [approvedText] = t.telegram.textsTo(approved.user.telegramId);
    expect(approvedText).toContain('Вас приняли на «Настолки»!');
    expect(approvedText).toContain(`Точный адрес: ${CANARY_ADDRESS}`);
    const venues = t.telegram.sent('sendVenue', approved.user.telegramId);
    expect(venues).toHaveLength(1);
    expect(venues[0]!.payload).toMatchObject({ latitude: CANARY_POINT.lat, longitude: CANARY_POINT.lng });
    expect(t.telegram.sent('sendMessage', approved.user.telegramId)).toHaveLength(1);

    const [rejectedText] = t.telegram.textsTo(rejected.user.telegramId);
    expect(rejectedText).toBe(
      'Заявку на «Настолки» не приняли. Загляните в ленту: там есть и другие встречи.',
    );
    expect(JSON.stringify(t.telegram.sent('sendMessage', rejected.user.telegramId))).not.toContain('CANARY');
    expect(JSON.stringify(t.telegram.sent('sendMessage', host.user.telegramId))).not.toContain('CANARY');
  });

  it('tells the host when a member leaves and removes the member from the group', async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Кино' });
    const member = await t.loginOnboarded(undefined, 'Олег');
    const memberRow = await setMembership(t.db, lobby.id, member.user.id, 'approved');
    const chatId = freshChatId();
    await linkChat(t.db, lobby.id, chatId);
    await t.db
      .update(lobbyMembers)
      .set({ chatJoinedAt: new Date() })
      .where(eq(lobbyMembers.id, memberRow.id));

    expect((await api.cancelOwn(member.token, lobby.id)).statusCode).toBe(200);
    await send();
    expect(t.telegram.textsTo(host.user.telegramId)).toEqual([
      'Олег больше не идёт на «Кино». Освободилось место: занято 0 из 3.',
    ]);
    expect(t.telegram.sent('banChatMember', chatId)[0]?.payload).toMatchObject({
      user_id: member.user.telegramId,
    });
    expect(t.telegram.sent('unbanChatMember', chatId)[0]?.payload).toMatchObject({
      user_id: member.user.telegramId,
      only_if_banned: true,
    });
  });

  it('tells pending and approved members and the group about a cancel, without the address in the group', async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Прогулка' });
    const approved = await t.loginOnboarded();
    const pending = await t.loginOnboarded();
    const rejected = await t.loginOnboarded();
    await setMembership(t.db, lobby.id, approved.user.id, 'approved');
    await setMembership(t.db, lobby.id, pending.user.id, 'pending');
    await setMembership(t.db, lobby.id, rejected.user.id, 'rejected');
    const chatId = freshChatId();
    const link = await linkChat(t.db, lobby.id, chatId);

    const response = await api.cancel(host.token, lobby.id, { reason: 'plans_changed', comment: 'Простите' });
    expect(response.statusCode, response.body).toBe(200);
    await api.cancel(host.token, lobby.id);
    await send();

    for (const user of [approved, pending]) {
      const [text] = t.telegram.textsTo(user.user.telegramId);
      expect(text).toContain('Встречу «Прогулка»');
      expect(text).toContain('Причина: Изменились планы.');
      expect(text).toContain('Комментарий хоста: Простите');
    }
    expect(t.telegram.textsTo(rejected.user.telegramId)).toEqual([]);
    expect(t.telegram.sent('revokeChatInviteLink', chatId)[0]?.payload).toMatchObject({ invite_link: link });
    expect(t.telegram.textsTo(chatId)).toHaveLength(1);
    expect(JSON.stringify(t.telegram.sent('sendMessage', chatId))).not.toContain('CANARY');
    expect(everything().split('CANARY').length - 1).toBe(0);
  });
});
