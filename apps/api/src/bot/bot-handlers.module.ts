import { Module } from '@nestjs/common';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { BotModule } from './bot.module.js';
import { BotUpdates } from './bot.updates.js';

/** The bot's update handlers; kept apart from BotModule so lobby services can use the outbox. */
@Module({
  imports: [BotModule, LobbiesModule],
  providers: [BotUpdates],
})
export class BotHandlersModule {}
