import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BotError, GrammyError, HttpError, type Bot, type Context } from 'grammy';
import { users, type Database } from '@masl/db';
import { RATE_LIMITS } from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { formatRedacted, redactError } from '../errors/redacting-exception.filter.js';
import { ApiException } from '../errors/api-error.js';
import { AttendanceService } from '../lobbies/attendance.service.js';
import { ChatService, type LinkOutcome } from '../lobbies/chat.service.js';
import { FeedbackService, type FeedbackOutcome } from '../lobbies/feedback.service.js';
import { LobbiesService } from '../lobbies/lobbies.service.js';
import { FixedWindowStore } from '../rate-limit/fixed-window.store.js';
import { decodeCallback, encodeCallback, type BotCallback } from './callbacks.js';
import { attendancePollMarkup, quorumMarkup } from './outbox.renderer.js';
import { AppLinks, appPaths } from './app-links.js';
import { BOT } from './bot.provider.js';
import { texts } from './messages.js';
import { describeTelegramError } from './telegram-errors.js';

/** The update's kind for logs, never its content. */
const updateKind = (ctx: Context) => Object.keys(ctx.update).find((key) => key !== 'update_id') ?? '-';

/**
 * Handlers of the bot's updates. Users are matched by their Telegram id only; whatever a
 * handler changes goes through the same services and ownership checks as the app.
 */
@Injectable()
export class BotUpdates implements OnModuleInit {
  private readonly log = new Logger('Bot');

  constructor(
    @Inject(BOT) private readonly bot: Bot,
    @Inject(DB) private readonly db: Database,
    @Inject(AppLinks) private readonly links: AppLinks,
    @Inject(ChatService) private readonly chats: ChatService,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(FeedbackService) private readonly feedback: FeedbackService,
    @Inject(FixedWindowStore) private readonly limits: FixedWindowStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    const bot = this.bot;
    bot.catch((error: BotError) => {
      const cause = error.error;
      const where = updateKind(error.ctx);
      this.log.error(
        cause instanceof GrammyError || cause instanceof HttpError
          ? `Бот: ошибка обработки ${where}: ${describeTelegramError(cause)}`
          : formatRedacted(`бота (${where})`, redactError(cause)),
      );
    });

    const privateChats = bot.chatType('private');
    privateChats.command('start', async (ctx) => {
      await this.setWriteAccess(ctx.from.id, true);
      const open = await this.links.button('Открыть', appPaths.feed());
      await ctx.reply(open ? texts.start() : `${texts.start()}\n${texts.openAppHint}`, {
        reply_markup: open ? { inline_keyboard: [[open]] } : undefined,
      });
    });
    privateChats.on('message:write_access_allowed', (ctx) => this.setWriteAccess(ctx.from.id, true));
    privateChats.on('my_chat_member', (ctx) => {
      const status = ctx.myChatMember.new_chat_member.status;
      return this.setWriteAccess(ctx.from.id, status === 'member');
    });

    // The meetup group (spec stage 3 §7).
    privateChats.on('message:chat_shared', async (ctx) => {
      const shared = ctx.message.chat_shared;
      const outcome = await this.chats.link(ctx.from.id, shared.request_id, shared.chat_id, shared.title);
      await ctx.reply(linkReply(outcome), { reply_markup: { remove_keyboard: true } });
    });
    bot.on('chat_join_request', (ctx) =>
      this.chats.decideJoin(ctx.chatJoinRequest.chat.id, ctx.chatJoinRequest.from.id),
    );
    const groups = bot.chatType(['group', 'supergroup']);
    groups.on('my_chat_member', (ctx) => {
      const member = ctx.myChatMember.new_chat_member;
      return member.status === 'left' || member.status === 'kicked'
        ? this.chats.botRemoved(ctx.chat.id)
        : this.chats.rightsChanged(ctx.chat.id, member);
    });
    groups.on('message:migrate_to_chat_id', (ctx) =>
      this.chats.migrated(ctx.chat.id, ctx.message.migrate_to_chat_id),
    );

    bot.on('callback_query:data', async (ctx) => {
      const callback = decodeCallback(ctx.callbackQuery.data);
      if (!callback) return ctx.answerCallbackQuery({ text: texts.notActual });
      const [user] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.telegramId, ctx.from.id));
      if (!user) return ctx.answerCallbackQuery({ text: texts.unknownUser });
      const { limit, windowSeconds } = RATE_LIMITS.botCallback;
      const allowed = this.limits.take(
        [{ key: `botCallback:${user.id}`, limit, windowMs: windowSeconds * 1000 }],
        this.clock.now().getTime(),
      );
      if (!allowed.allowed) return ctx.answerCallbackQuery({ text: 'Слишком часто. Подождите немного' });
      try {
        await this.onCallback(ctx, user.id, callback);
      } catch (error) {
        // A refusal of the service (not the host, already started) is the answer itself.
        if (!(error instanceof ApiException)) throw error;
        await ctx.answerCallbackQuery({ text: error.body.message });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      }
    });
  }

  /** One tap on an inline button, by the app user `userId`; services check who may do what. */
  private async onCallback(ctx: Context, userId: string, callback: BotCallback): Promise<void> {
    const message = ctx.callbackQuery?.message;
    const original = message && 'text' in message ? (message.text ?? '') : '';
    switch (callback.action) {
      case 'quorum_lower': {
        const minKarma = await this.lobbies.lowerMinKarma(userId, callback.lobbyId);
        await ctx.answerCallbackQuery({ text: texts.quorumLowered(minKarma) });
        await ctx.editMessageText(`${original}\n\n${texts.quorumLowered(minKarma)}`, {
          reply_markup: quorumMarkup({ id: callback.lobbyId, minKarma }),
        });
        return;
      }
      case 'quorum_cancel': {
        const preview = await this.lobbies.cancelPreview(userId, callback.lobbyId);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(texts.quorumCancelConfirm(preview.title, preview.penalized), {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Да, отменить',
                  callback_data: encodeCallback({
                    action: 'quorum_cancel_confirm',
                    lobbyId: callback.lobbyId,
                  }),
                },
              ],
              [
                {
                  text: 'Не отменять',
                  callback_data: encodeCallback({ action: 'quorum_keep', lobbyId: callback.lobbyId }),
                },
              ],
            ],
          },
        });
        return;
      }
      case 'quorum_cancel_confirm': {
        await this.lobbies.cancel(userId, callback.lobbyId, { reason: 'not_enough_people', comment: null });
        await ctx.answerCallbackQuery({ text: texts.quorumCancelled });
        await ctx.editMessageText(texts.quorumCancelled);
        return;
      }
      case 'quorum_keep': {
        await this.lobbies.cancelPreview(userId, callback.lobbyId);
        await ctx.answerCallbackQuery({ text: texts.quorumKept });
        await ctx.editMessageText(`${original}\n\n${texts.quorumKept}`);
        return;
      }
      case 'attendance_toggle': {
        const poll = await this.attendance.toggleDraft(userId, callback.memberId);
        await ctx.answerCallbackQuery(poll.changed ? undefined : { text: texts.attendanceCheckedIn });
        if (poll.changed) {
          const app = await this.links.button('Открыть список', appPaths.attendance(poll.lobbyId));
          await ctx.editMessageReplyMarkup({
            reply_markup: attendancePollMarkup(poll.lobbyId, poll.members, app),
          });
        }
        return;
      }
      case 'attendance_save': {
        const saved = await this.attendance.saveDrafts(userId, callback.lobbyId);
        const absent = saved.members.filter((m) => m.status === 'no_show').length;
        const summary = texts.attendanceSaved(saved.members.length - absent, absent);
        await ctx.answerCallbackQuery({ text: summary });
        await ctx.editMessageText(`${original}\n\n${summary}`);
        return;
      }
      case 'feedback': {
        const outcome = await this.feedback.record(userId, callback.lobbyId, callback.rating);
        const answer = feedbackReply(outcome);
        await ctx.answerCallbackQuery({ text: answer });
        await ctx.editMessageText(`${original}\n\n${answer}`);
        return;
      }
    }
  }

  /** Whether the bot may write to the user privately (users.allows_write_to_pm). */
  private async setWriteAccess(telegramId: number, allowed: boolean): Promise<void> {
    await this.db.update(users).set({ allowsWriteToPm: allowed }).where(eq(users.telegramId, telegramId));
  }
}

function feedbackReply(outcome: FeedbackOutcome): string {
  if (outcome === 'recorded') return texts.feedbackThanks;
  return outcome === 'repeat' ? texts.feedbackAlready : texts.notActual;
}

function linkReply(outcome: LinkOutcome): string {
  if (outcome.ok) return texts.chatLinked(outcome.title, outcome.hasPeople);
  if (outcome.reason === 'rights') return texts.chatMissingRights(outcome.missing);
  return outcome.reason === 'taken' ? texts.chatTaken : texts.chatRequestStale;
}
