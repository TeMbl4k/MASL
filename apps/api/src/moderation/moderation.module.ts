import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { KarmaModule } from '../karma/karma.module.js';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { SessionModule } from '../session/session.module.js';
import { AdminController } from './admin.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AppealsController } from './appeals.controller.js';
import { AppealsService } from './appeals.service.js';
import { ModerationService } from './moderation.service.js';
import { ModeratorGuard } from './moderator.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Reports, moderation cases, appeals and the moderators' tools (stage 4). */
@Module({
  imports: [SessionModule, LobbiesModule, KarmaModule, BotModule],
  controllers: [ReportsController, AppealsController, AdminController, AdminUsersController],
  providers: [ReportsService, AppealsService, ModerationService, AdminUsersService, ModeratorGuard],
})
export class ModerationModule {}
