import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BotError, GrammyError, HttpError, type Bot, type Context } from 'grammy';
import { users, type Database } from '@masl/db';
import { DB } from '../db/db.module.js';
import { formatRedacted, redactError } from '../errors/redacting-exception.filter.js';
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
  }

  /** Whether the bot may write to the user privately (users.allows_write_to_pm). */
  private async setWriteAccess(telegramId: number, allowed: boolean): Promise<void> {
    await this.db.update(users).set({ allowsWriteToPm: allowed }).where(eq(users.telegramId, telegramId));
  }
}
