import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BotError, GrammyError, HttpError, type Bot, type Context } from 'grammy';
import { users, type Database } from '@masl/db';
import { DB } from '../db/db.module.js';
import { formatRedacted, redactError } from '../errors/redacting-exception.filter.js';
import { ChatService, type LinkOutcome } from '../lobbies/chat.service.js';
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
  }

  /** Whether the bot may write to the user privately (users.allows_write_to_pm). */
  private async setWriteAccess(telegramId: number, allowed: boolean): Promise<void> {
    await this.db.update(users).set({ allowsWriteToPm: allowed }).where(eq(users.telegramId, telegramId));
  }
}

function linkReply(outcome: LinkOutcome): string {
  if (outcome.ok) return texts.chatLinked(outcome.title, outcome.hasPeople);
  if (outcome.reason === 'rights') return texts.chatMissingRights(outcome.missing);
  return outcome.reason === 'taken' ? texts.chatTaken : texts.chatRequestStale;
}
