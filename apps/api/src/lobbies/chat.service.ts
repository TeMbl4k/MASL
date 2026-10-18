import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Bot } from 'grammy';
import type { ChatAdministratorRights, ChatMember, KeyboardButton } from 'grammy/types';
import { lobbies, lobbyChatRequests, lobbyMembers, users, type Database } from '@masl/db';
import {
  CHAT_REQUEST_TTL_MINUTES,
  MINUTE_MS,
  effectiveLobbyStatus,
  type ChatPrepareInput,
  type ChatPrepareResponse,
  type LobbyStatus,
} from '@masl/shared';
import { BOT } from '../bot/bot.provider.js';
import { REQUIRED_CHAT_RIGHTS, texts } from '../bot/messages.js';
import { OutboxService } from '../bot/outbox.service.js';
import { describeTelegramError } from '../bot/telegram-errors.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { LobbiesService } from './lobbies.service.js';
import { lockLobby } from './lobby-queries.js';

/** Rights the bot asks for in the meetup group: let members in, remove those who left, tidy up. */
const BOT_RIGHTS: ChatAdministratorRights = {
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
  can_pin_messages: true,
  can_send_welcome_messages: false,
};

const CHAT_STATUSES: readonly LobbyStatus[] = ['open', 'active'];

/** What the bot answers the host after a group was picked. */
export type LinkOutcome =
  | { ok: true; title: string; hasPeople: boolean }
  | { ok: false; reason: 'stale' | 'taken' }
  | { ok: false; reason: 'rights'; missing: string[] };

/** Required rights the bot lacks as this chat member, by name; empty when all are there. */
export function missingRights(member: ChatMember): string[] {
  return (Object.keys(REQUIRED_CHAT_RIGHTS) as (keyof typeof REQUIRED_CHAT_RIGHTS)[])
    .filter((right) => !(member.status === 'creator' || (member.status === 'administrator' && member[right])))
    .map((right) => REQUIRED_CHAT_RIGHTS[right]);
}

/**
 * The meetup group (spec stage 3 §7): the host picks or creates a Telegram group, the bot becomes
 * its admin and admits by join request only the lobby's approved members.
 */
@Injectable()
export class ChatService {
  private readonly log = new Logger('Bot');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /**
   * «Создать чат встречи»: a request_chat button for the host, as a prepared button for
   * WebApp.requestChat (`app`) or as a keyboard in the bot's private chat (`bot`).
   */
  async prepare(hostId: string, lobbyId: string, input: ChatPrepareInput): Promise<ChatPrepareResponse> {
    const now = this.clock.now();
    const { requestId, telegramId } = await this.db.transaction(async (tx) => {
      if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
      const { rights, effectiveStatus } = await this.lobbies.visibleLobby(tx, lobbyId, hostId, now);
      if (!rights.isHost) throw apiError('not_host');
      if (effectiveStatus === 'cancelled') throw apiError('lobby_cancelled');
      if (!CHAT_STATUSES.includes(effectiveStatus)) throw apiError('lobby_closed');
      const [lobby] = await tx
        .select({ chatId: lobbies.chatId, chatClosedAt: lobbies.chatClosedAt })
        .from(lobbies)
        .where(eq(lobbies.id, lobbyId));
      if (lobby?.chatId != null && lobby.chatClosedAt === null) throw apiError('chat_already_linked');
      const [request] = await tx
        .insert(lobbyChatRequests)
        .values({ lobbyId, hostId, createdAt: now })
        .returning({ id: lobbyChatRequests.id });
      const [host] = await tx
        .select({ telegramId: users.telegramId })
        .from(users)
        .where(eq(users.id, hostId));
      return { requestId: request!.id, telegramId: host!.telegramId };
    });

    const button = {
      text: texts.chatPickerButton,
      request_chat: {
        request_id: requestId,
        chat_is_channel: false,
        bot_is_member: true,
        request_title: true,
        user_administrator_rights: BOT_RIGHTS,
        bot_administrator_rights: BOT_RIGHTS,
      },
    } satisfies KeyboardButton.RequestChatButton;
    try {
      if (input.via === 'app') {
        const prepared = await this.bot.api.savePreparedKeyboardButton(telegramId, button);
        return { preparedButtonId: prepared.id };
      }
      await this.bot.api.sendMessage(telegramId, texts.chatPickerPrompt, {
        reply_markup: { keyboard: [[button]], one_time_keyboard: true, resize_keyboard: true },
      });
      return { preparedButtonId: null };
    } catch (error) {
      this.log.warn(`Бот: кнопка выбора группы не создана: ${describeTelegramError(error)}`);
      throw apiError('bot_unavailable');
    }
  }

  /**
   * A group picked with the button (chat_shared): only by the host who asked, within
   * CHAT_REQUEST_TTL_MINUTES, for a lobby still open or active and without a group.
   */
  async link(
    fromTelegramId: number,
    requestId: number,
    chatId: number,
    title: string | undefined,
  ): Promise<LinkOutcome> {
    const now = this.clock.now();
    const [request] = await this.db
      .select({ id: lobbyChatRequests.id, lobbyId: lobbyChatRequests.lobbyId })
      .from(lobbyChatRequests)
      .innerJoin(users, eq(users.id, lobbyChatRequests.hostId))
      .innerJoin(lobbies, eq(lobbies.id, lobbyChatRequests.lobbyId))
      .where(
        and(
          eq(lobbyChatRequests.id, requestId),
          isNull(lobbyChatRequests.usedAt),
          gt(lobbyChatRequests.createdAt, new Date(now.getTime() - CHAT_REQUEST_TTL_MINUTES * MINUTE_MS)),
          eq(users.telegramId, fromTelegramId),
          eq(lobbies.hostId, lobbyChatRequests.hostId),
        ),
      );
    if (!request) return { ok: false, reason: 'stale' };

    const missing = missingRights(await this.bot.api.getChatMember(chatId, this.bot.botInfo.id));
    if (missing.length > 0) return { ok: false, reason: 'rights', missing };

    const lobby = await this.chatLobby(this.db, request.lobbyId);
    if (!lobby) return { ok: false, reason: 'stale' };
    const invite = await this.bot.api.createChatInviteLink(chatId, {
      name: 'MASL',
      creates_join_request: true,
      expire_date: Math.floor(lobby.endsAt.getTime() / 1000),
    });
    const people = await this.bot.api.getChatMemberCount(chatId);
    const chatTitle = (title ?? lobby.title).slice(0, 128);

    try {
      return await this.db.transaction(async (tx) => {
        if (!(await lockLobby(tx, request.lobbyId))) return { ok: false, reason: 'stale' } as const;
        const current = await this.chatLobby(tx, request.lobbyId);
        if (!current) return { ok: false, reason: 'stale' } as const;
        const used = await tx
          .update(lobbyChatRequests)
          .set({ usedAt: now })
          .where(and(eq(lobbyChatRequests.id, request.id), isNull(lobbyChatRequests.usedAt)))
          .returning({ id: lobbyChatRequests.id });
        if (used.length === 0) return { ok: false, reason: 'stale' } as const;
        await tx
          .update(lobbies)
          .set({
            chatId,
            chatTitle,
            chatInviteLink: invite.invite_link,
            chatLinkedAt: now,
            chatClosedAt: null,
            updatedAt: now,
          })
          .where(eq(lobbies.id, request.lobbyId));
        await this.invite(tx, request.lobbyId, chatId, now, true);
        // The bot and the host; anyone else already in the group will see the members' chat.
        return { ok: true, title: lobby.title, hasPeople: people > 2 } as const;
      });
    } catch (error) {
      if (
        (error as { cause?: { constraint_name?: string } }).cause?.constraint_name ===
        'lobbies_active_chat_uq'
      ) {
        return { ok: false, reason: 'taken' };
      }
      throw error;
    }
  }

  /** A join request to a meetup group: approved members of an open or active lobby only. */
  async decideJoin(chatId: number, telegramId: number): Promise<void> {
    const now = this.clock.now();
    const [row] = await this.db
      .select({
        memberId: lobbyMembers.id,
        memberStatus: lobbyMembers.status,
        status: lobbies.status,
        startsAt: lobbies.startsAt,
        endsAt: lobbies.endsAt,
      })
      .from(lobbies)
      .innerJoin(lobbyMembers, eq(lobbyMembers.lobbyId, lobbies.id))
      .innerJoin(users, eq(users.id, lobbyMembers.userId))
      .where(and(eq(lobbies.chatId, chatId), isNull(lobbies.chatClosedAt), eq(users.telegramId, telegramId)));
    const admit = row?.memberStatus === 'approved' && CHAT_STATUSES.includes(effectiveLobbyStatus(row, now));
    if (!admit) {
      await this.bot.api.declineChatJoinRequest(chatId, telegramId);
      return;
    }
    await this.bot.api.approveChatJoinRequest(chatId, telegramId);
    await this.db
      .update(lobbyMembers)
      .set({ chatJoinedAt: now, updatedAt: now })
      .where(eq(lobbyMembers.id, row.memberId));
  }

  /** The bot left the group or was removed: the lobby has no group any more. */
  async botRemoved(chatId: number): Promise<void> {
    const now = this.clock.now();
    await this.db
      .update(lobbies)
      .set({ chatClosedAt: now, updatedAt: now })
      .where(and(eq(lobbies.chatId, chatId), isNull(lobbies.chatClosedAt)));
  }

  /** The bot lost rights it needs: tells the host which ones. */
  async rightsChanged(chatId: number, member: ChatMember): Promise<void> {
    const missing = missingRights(member);
    if (missing.length === 0) return;
    const [lobby] = await this.db
      .select({ title: lobbies.title, hostTelegramId: users.telegramId })
      .from(lobbies)
      .innerJoin(users, eq(users.id, lobbies.hostId))
      .where(and(eq(lobbies.chatId, chatId), isNull(lobbies.chatClosedAt)));
    if (!lobby) return;
    await this.bot.api.sendMessage(lobby.hostTelegramId, texts.chatRightsLost(lobby.title, missing));
  }

  /**
   * A basic group became a supergroup and got a new id: the lobby follows it with a fresh invite
   * link, sent again to approved members who haven't joined.
   */
  async migrated(oldChatId: number, newChatId: number): Promise<void> {
    const [lobby] = await this.db
      .select({ id: lobbies.id, endsAt: lobbies.endsAt })
      .from(lobbies)
      .where(and(eq(lobbies.chatId, oldChatId), isNull(lobbies.chatClosedAt)));
    if (!lobby) return;
    const invite = await this.bot.api.createChatInviteLink(newChatId, {
      name: 'MASL',
      creates_join_request: true,
      expire_date: Math.floor(lobby.endsAt.getTime() / 1000),
    });
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(lobbies)
        .set({ chatId: newChatId, chatInviteLink: invite.invite_link, updatedAt: now })
        .where(and(eq(lobbies.id, lobby.id), eq(lobbies.chatId, oldChatId)));
      await this.invite(tx, lobby.id, newChatId, now, false);
    });
  }

  /** Queues the invite link for approved members not yet in the group, and the welcome. */
  private async invite(tx: DbTransaction, lobbyId: string, chatId: number, now: Date, welcome: boolean) {
    const members = await tx
      .select({ id: lobbyMembers.id, userId: lobbyMembers.userId })
      .from(lobbyMembers)
      .where(
        and(
          eq(lobbyMembers.lobbyId, lobbyId),
          eq(lobbyMembers.status, 'approved'),
          isNull(lobbyMembers.chatJoinedAt),
        ),
      );
    await this.outbox.enqueue(
      tx,
      [
        ...(welcome ? [{ kind: 'group_welcome' as const, chatId, lobbyId }] : []),
        ...members.map((m) => ({
          kind: 'member_chat_ready' as const,
          userId: m.userId,
          lobbyId,
          memberId: m.id,
        })),
      ],
      now,
    );
  }

  /** The lobby if it can take a group now: open or active, no group linked. */
  private async chatLobby(db: Database | DbTransaction, lobbyId: string) {
    const [lobby] = await db
      .select({
        title: lobbies.title,
        status: lobbies.status,
        startsAt: lobbies.startsAt,
        endsAt: lobbies.endsAt,
        linked: sql<boolean>`${lobbies.chatId} is not null and ${lobbies.chatClosedAt} is null`.mapWith(
          Boolean,
        ),
      })
      .from(lobbies)
      .where(eq(lobbies.id, lobbyId));
    if (!lobby || lobby.linked || !CHAT_STATUSES.includes(effectiveLobbyStatus(lobby, this.clock.now()))) {
      return null;
    }
    return lobby;
  }
}
