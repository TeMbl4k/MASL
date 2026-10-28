import { Module } from '@nestjs/common';
import { BroadcastsModule } from '../broadcasts/broadcasts.module.js';
import { InvitesModule } from '../invites/invites.module.js';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { BotModule } from './bot.module.js';
import { BotUpdates } from './bot.updates.js';

/** The bot's update handlers; kept apart from BotModule so lobby services can use the outbox. */
@Module({
  imports: [BotModule, LobbiesModule, InvitesModule, BroadcastsModule],
  providers: [BotUpdates],
})
export class BotHandlersModule {}
