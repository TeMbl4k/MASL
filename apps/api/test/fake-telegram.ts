import type { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';

export const FAKE_BOT: UserFromGetMe = {
  id: 999_000_001,
  is_bot: true,
  first_name: 'MASL',
  username: 'masl_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export const FAKE_APP_URL = 'https://masl.example/';

export interface TelegramCallRecord {
  method: string;
  payload: Record<string, unknown>;
}

type Reply = unknown | ((payload: Record<string, unknown>) => unknown);

interface Failure {
  error_code: number;
  description: string;
  retry_after?: number;
}

/**
 * The Bot API for tests: records every call and answers with canned results; no network.
 * `fail(method, …)` makes the next calls of a method fail; `respond` overrides a result.
 */
export class FakeTelegram {
  readonly calls: TelegramCallRecord[] = [];
  private readonly replies = new Map<string, Reply>();
  private readonly failures = new Map<string, Failure[]>();
  private seq = 100;
  private updateSeq = 1;

  install(bot: Bot): void {
    bot.botInfo = FAKE_BOT;
    bot.api.config.use(async (_prev, method, payload) => {
      const body = (payload ?? {}) as Record<string, unknown>;
      this.calls.push({ method, payload: body });
      const failure = this.failures.get(method)?.shift();
      if (failure) {
        return {
          ok: false,
          error_code: failure.error_code,
          description: failure.description,
          parameters: failure.retry_after ? { retry_after: failure.retry_after } : {},
        } as never;
      }
      const reply = this.replies.get(method);
      const result =
        reply === undefined
          ? this.defaultResult(method, body)
          : typeof reply === 'function'
            ? reply(body)
            : reply;
      return { ok: true, result } as never;
    });
  }

  respond(method: string, reply: Reply): void {
    this.replies.set(method, reply);
  }

  fail(method: string, failure: Failure, times = 1): void {
    const queue = this.failures.get(method) ?? [];
    for (let i = 0; i < times; i++) queue.push(failure);
    this.failures.set(method, queue);
  }

  /** Calls of a method since the last reset, optionally to one chat. */
  sent(method: string, chatId?: number): TelegramCallRecord[] {
    return this.calls.filter(
      (c) => c.method === method && (chatId === undefined || c.payload.chat_id === chatId),
    );
  }

  /** Texts of sendMessage calls to a chat. */
  textsTo(chatId: number): string[] {
    return this.sent('sendMessage', chatId).map((c) => String(c.payload.text));
  }

  reset(): void {
    this.calls.length = 0;
    this.replies.clear();
    this.failures.clear();
  }

  nextUpdateId(): number {
    return this.updateSeq++;
  }

  /** A full Update with a fresh update_id. */
  update(body: Omit<Update, 'update_id'>): Update {
    return { update_id: this.nextUpdateId(), ...body } as Update;
  }

  private defaultResult(method: string, body: Record<string, unknown>): unknown {
    const chat = { id: Number(body.chat_id ?? 0), type: Number(body.chat_id) < 0 ? 'supergroup' : 'private' };
    switch (method) {
      case 'sendMessage':
      case 'sendVenue':
      case 'editMessageText':
        return { message_id: ++this.seq, date: 0, chat, text: body.text };
      case 'getChatMenuButton':
        return { type: 'web_app', text: 'Открыть', web_app: { url: FAKE_APP_URL } };
      case 'savePreparedKeyboardButton':
        return { id: `prepared-${++this.seq}` };
      case 'savePreparedInlineMessage':
        return { id: `prepared-message-${++this.seq}`, expiration_date: 0 };
      case 'createChatInviteLink':
        return {
          invite_link: `https://t.me/+fake${++this.seq}`,
          creator: FAKE_BOT,
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        };
      case 'revokeChatInviteLink':
        return {
          invite_link: body.invite_link,
          creator: FAKE_BOT,
          creates_join_request: true,
          is_primary: false,
          is_revoked: true,
        };
      case 'getChatMember':
        return {
          status: 'administrator',
          user: FAKE_BOT,
          can_be_edited: false,
          is_anonymous: false,
          can_manage_chat: true,
          can_delete_messages: true,
          can_manage_video_chats: false,
          can_restrict_members: true,
          can_promote_members: false,
          can_change_info: false,
          can_invite_users: true,
          can_post_stories: false,
          can_edit_stories: false,
          can_delete_stories: false,
        };
      case 'getChatMemberCount':
        return 2;
      default:
        return true;
    }
  }
}
