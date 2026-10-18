import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { KarmaModule } from '../karma/karma.module.js';
import { SessionModule } from '../session/session.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { ChatService } from './chat.service.js';
import { FeedbackService } from './feedback.service.js';
import { FeedService } from './feed.service.js';
import { LobbiesController } from './lobbies.controller.js';
import { LobbiesService } from './lobbies.service.js';
import { LobbyStatusSweeper } from './lobby-status.sweeper.js';
import { MeLobbiesController } from './me-lobbies.controller.js';

/** Lobbies, applications, feed and map. */
@Module({
  imports: [SessionModule, KarmaModule, BotModule],
  controllers: [LobbiesController, ApplicationsController, AttendanceController, MeLobbiesController],
  providers: [
    LobbiesService,
    ApplicationsService,
    AttendanceService,
    FeedbackService,
    FeedService,
    LobbyStatusSweeper,
    ChatService,
  ],
  exports: [LobbiesService, ChatService, AttendanceService, FeedbackService],
})
export class LobbiesModule {}
