import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { KarmaModule } from '../karma/karma.module.js';
import { SessionModule } from '../session/session.module.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { ChatService } from './chat.service.js';
import { FeedService } from './feed.service.js';
import { LobbiesController } from './lobbies.controller.js';
import { LobbiesService } from './lobbies.service.js';
import { LobbyStatusSweeper } from './lobby-status.sweeper.js';
import { MeLobbiesController } from './me-lobbies.controller.js';

/** Lobbies, applications, feed and map. */
@Module({
  imports: [SessionModule, KarmaModule, BotModule],
  controllers: [LobbiesController, ApplicationsController, MeLobbiesController],
  providers: [LobbiesService, ApplicationsService, FeedService, LobbyStatusSweeper, ChatService],
  exports: [LobbiesService, ChatService],
})
export class LobbiesModule {}
