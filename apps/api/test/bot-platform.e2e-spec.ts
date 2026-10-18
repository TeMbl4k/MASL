import { eq } from 'drizzle-orm';
import { notifications, users } from '@masl/db';
import type { MeDto, NotificationKind } from '@masl/shared';
import { OutboxService, type OutboxMessage } from '../src/bot/outbox.service.js';
import { FAKE_APP_URL } from './fake-telegram.js';
import {
  adminUrl,
  authHeader,
  bootApp,
  insertLobby,
  insertUser,
  setMembership,
  type TestApp,
} from './helpers.js';

const HOUR_MS = 3_600_000;

describe.skipIf(!adminUrl)('bot platform e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.telegram.reset();
  });

  const enqueue = (messages: OutboxMessage[], now = new Date()) =>
    t.db.transaction((tx) => t.app.get(OutboxService).enqueue(tx, messages, now));
  const rowsOf = (lobbyId: string) =>
    t.db.select().from(notifications).where(eq(notifications.lobbyId, lobbyId)).orderBy(notifications.id);
  const writeAccess = async (userId: string) =>
    (await t.db.select({ v: users.allowsWriteToPm }).from(users).where(eq(users.id, userId)))[0]?.v;
  const privateChat = (id: number) => ({ id, type: 'private' as const, first_name: 'Тест' });
  const from = (id: number) => ({ id, is_bot: false, first_name: 'Тест' });

  /** A rejected applicant: member_rejected renders for them while they stay rejected. */
  async function rejectedFixture() {
    const host = await insertUser(t.db);
    const user = await insertUser(t.db);
    const lobby = await insertLobby(t.db, { hostId: host.id });
    const member = await setMembership(t.db, lobby.id, user.id, 'rejected');
    const message = (kind: NotificationKind = 'member_rejected'): OutboxMessage => ({
      kind,
      userId: user.id,
      lobbyId: lobby.id,
      memberId: member.id,
    });
    return { host, user, lobby, member, message };
  }

  describe('write access', () => {
    it('/start allows private messages and answers with the app button', async () => {
      const auth = await t.login();
      const me = () =>
        t.app
          .inject({ method: 'GET', url: '/api/me', headers: authHeader(auth.token) })
          .then((r) => r.json<MeDto>());
      expect((await me()).botCanWrite).toBe(false);

      const telegramId = auth.user.telegramId;
      await t.handleUpdate({
        message: {
          message_id: 1,
          date: 0,
          chat: privateChat(telegramId),
          from: from(telegramId),
          text: '/start',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }],
        },
      });
      expect((await me()).botCanWrite).toBe(true);
      const [reply] = t.telegram.sent('sendMessage', telegramId);
      expect(reply?.payload.reply_markup).toEqual({
        inline_keyboard: [[{ text: 'Открыть', web_app: { url: FAKE_APP_URL } }]],
      });
    });

    it('follows blocking and unblocking the bot and the write access prompt', async () => {
      const user = await insertUser(t.db, { allowsWriteToPm: true });
      const member = (status: 'kicked' | 'member') => ({
        my_chat_member: {
          chat: privateChat(user.telegramId),
          from: from(user.telegramId),
          date: 0,
          old_chat_member: { status: 'member' as const, user: from(1) },
          new_chat_member:
            status === 'kicked'
              ? { status: 'kicked' as const, user: from(1), until_date: 0 }
              : { status: 'member' as const, user: from(1) },
        },
      });
      await t.handleUpdate(member('kicked'));
      expect(await writeAccess(user.id)).toBe(false);
      await t.handleUpdate(member('member'));
      expect(await writeAccess(user.id)).toBe(true);

      await t.db.update(users).set({ allowsWriteToPm: false }).where(eq(users.id, user.id));
      await t.handleUpdate({
        message: {
          message_id: 2,
          date: 0,
          chat: privateChat(user.telegramId),
          from: from(user.telegramId),
          write_access_allowed: { from_request: true },
        },
      });
      expect(await writeAccess(user.id)).toBe(true);
    });
  });

  describe('outbox', () => {
    it('sends a queued message once and records it', async () => {
      const { user, lobby, message } = await rejectedFixture();
      await enqueue([message()]);
      expect(await t.flushOutbox()).toBe(1);
      expect(await t.flushOutbox()).toBe(0);

      expect(t.telegram.textsTo(user.telegramId)).toEqual([
        'Заявку на «Тестовая встреча» не приняли. Загляните в ленту: там есть и другие встречи.',
      ]);
      const [row] = await rowsOf(lobby.id);
      expect(row?.sentAt).toBeInstanceOf(Date);
      expect(row?.telegramMessageId).toBeTypeOf('number');
    });

    it('skips a message that is no longer true without calling Telegram', async () => {
      const { user, lobby, message } = await rejectedFixture();
      await enqueue([message()]);
      await setMembership(t.db, lobby.id, user.id, 'approved');
      await t.flushOutbox();
      expect(t.telegram.calls.filter((c) => c.method !== 'getChatMenuButton')).toEqual([]);
      expect((await rowsOf(lobby.id))[0]?.sentAt).toBeInstanceOf(Date);
    });

    it('keeps one pending row per dedupe key', async () => {
      const { lobby, message } = await rejectedFixture();
      await enqueue([{ ...message(), dedupeKey: `k:${lobby.id}` }]);
      await enqueue([{ ...message(), dedupeKey: `k:${lobby.id}` }]);
      expect(await rowsOf(lobby.id)).toHaveLength(1);
      await t.flushOutbox();
      await enqueue([{ ...message(), dedupeKey: `k:${lobby.id}` }]);
      expect(await rowsOf(lobby.id)).toHaveLength(2);
    });

    it('waits retry_after on 429', async () => {
      const { lobby, message } = await rejectedFixture();
      await enqueue([message()]);
      t.telegram.fail('sendMessage', { error_code: 429, description: 'Too Many Requests', retry_after: 7 });
      const before = Date.now();
      await t.flushOutbox();
      const [row] = await rowsOf(lobby.id);
      expect(row?.sentAt).toBeNull();
      expect(row?.attempts).toBe(0);
      expect(row!.sendAfter.getTime() - before).toBeGreaterThanOrEqual(7000);
    });

    it('gives up on 403 and stops writing to the user', async () => {
      const { user, lobby, message } = await rejectedFixture();
      await t.db.update(users).set({ allowsWriteToPm: true }).where(eq(users.id, user.id));
      await enqueue([message()]);
      t.telegram.fail('sendMessage', {
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      });
      await t.flushOutbox();
      const [row] = await rowsOf(lobby.id);
      expect(row).toMatchObject({ sentAt: null, lastErrorCode: 403 });
      expect(row?.failedAt).toBeInstanceOf(Date);
      expect(await writeAccess(user.id)).toBe(false);
    });

    it('backs off on server errors and fails after five attempts', async () => {
      const { lobby, message } = await rejectedFixture();
      await enqueue([message()]);
      t.telegram.fail('sendMessage', { error_code: 502, description: 'Bad Gateway' }, 5);
      for (let attempt = 1; attempt <= 5; attempt++) {
        const before = Date.now();
        await t.flushOutbox();
        const [row] = await rowsOf(lobby.id);
        expect(row?.attempts).toBe(attempt);
        if (attempt < 5) {
          expect(row?.failedAt).toBeNull();
          expect(row!.sendAfter.getTime() - before).toBeGreaterThanOrEqual(30_000 * 2 ** (attempt - 1));
          await t.db
            .update(notifications)
            .set({ sendAfter: new Date() })
            .where(eq(notifications.id, row!.id));
        } else {
          expect(row?.failedAt).toBeInstanceOf(Date);
        }
      }
    });

    it('drops news older than a day', async () => {
      const { user, lobby, message } = await rejectedFixture();
      await enqueue([message()], new Date(Date.now() - 25 * HOUR_MS));
      await t.flushOutbox();
      expect(t.telegram.textsTo(user.telegramId)).toEqual([]);
      expect((await rowsOf(lobby.id))[0]?.failedAt).toBeInstanceOf(Date);
    });
  });
});

describe.skipIf(!adminUrl)('bot without a Mini App menu button (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('sends messages without app buttons', async () => {
    t.telegram.respond('getChatMenuButton', { type: 'commands' });
    const host = await insertUser(t.db);
    const user = await insertUser(t.db);
    const lobby = await insertLobby(t.db, { hostId: host.id });
    const member = await setMembership(t.db, lobby.id, user.id, 'rejected');
    await t.db.transaction((tx) =>
      t.app
        .get(OutboxService)
        .enqueue(
          tx,
          [{ kind: 'member_rejected', userId: user.id, lobbyId: lobby.id, memberId: member.id }],
          new Date(),
        ),
    );
    await t.flushOutbox();
    const [call] = t.telegram.sent('sendMessage', user.telegramId);
    expect(call?.payload.reply_markup).toBeUndefined();
  });
});
