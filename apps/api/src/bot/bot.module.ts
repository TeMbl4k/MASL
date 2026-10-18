import { Module } from '@nestjs/common';
import { AppLinks } from './app-links.js';
import { botProvider, BOT } from './bot.provider.js';
import { BotRunner } from './bot.runner.js';
import { OutboxRenderer } from './outbox.renderer.js';
import { OutboxService } from './outbox.service.js';

/** The Telegram bot: polling, the message outbox and Mini App links. */
@Module({
  providers: [botProvider, BotRunner, AppLinks, OutboxRenderer, OutboxService],
  exports: [BOT, AppLinks, OutboxService],
})
export class BotModule {}
