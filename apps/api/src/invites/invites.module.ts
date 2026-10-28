import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { SessionModule } from '../session/session.module.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

/** Invites to lobbies (stage 6). */
@Module({
  imports: [SessionModule, LobbiesModule, BotModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
