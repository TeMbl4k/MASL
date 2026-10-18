import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { GrammyError, type Bot } from 'grammy';
import { ENV, type Env } from '../config/env.js';
import { BOT } from './bot.provider.js';
import { describeTelegramError } from './telegram-errors.js';

/** Updates the bot handles; everything else Telegram keeps to itself. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'chat_join_request', 'my_chat_member'] as const;

const RESTART_DELAY_MS = 30_000;

/**
 * Long polling inside the API process (decisions.md, stage 3): no public URL needed, and only one
 * copy of the app may poll with a token. A failure is logged and never stops the API.
 */
@Injectable()
export class BotRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Bot');
  private stopped = false;
  private retry: NodeJS.Timeout | undefined;

  constructor(
    @Inject(BOT) private readonly bot: Bot,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    // Tests feed updates through bot.handleUpdate().
    if (this.env.NODE_ENV === 'test') return;
    this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retry);
    if (this.bot.isRunning()) await this.bot.stop();
  }

  private start(): void {
    this.bot
      .start({
        allowed_updates: [...ALLOWED_UPDATES],
        drop_pending_updates: false,
        onStart: (me) => this.log.log(`Бот @${me.username} получает обновления`),
      })
      .catch((error: unknown) => this.failed(error));
  }

  private failed(error: unknown): void {
    if (error instanceof GrammyError && error.error_code === 401) {
      this.log.error('Бот не запущен: неверный BOT_TOKEN. Возьмите токен у @BotFather');
      return;
    }
    if (error instanceof GrammyError && error.error_code === 409) {
      this.log.error(
        'Бот не запущен: этот токен уже использует другая копия приложения. Остановите её или заведите отдельного бота для неё',
      );
      return;
    }
    this.log.error(`Бот остановился (${describeTelegramError(error)}), перезапуск через 30 секунд`);
    if (this.stopped) return;
    this.retry = setTimeout(() => this.start(), RESTART_DELAY_MS);
    this.retry.unref();
  }
}
