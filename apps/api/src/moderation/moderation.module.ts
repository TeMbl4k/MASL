import { Module } from '@nestjs/common';
import { KarmaModule } from '../karma/karma.module.js';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { SessionModule } from '../session/session.module.js';
import { AdminController } from './admin.controller.js';
import { ModerationService } from './moderation.service.js';
import { ModeratorGuard } from './moderator.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Reports, moderation cases, appeals and the moderators' tools (stage 4). */
@Module({
  imports: [SessionModule, LobbiesModule, KarmaModule],
  controllers: [ReportsController, AdminController],
  providers: [ReportsService, ModerationService, ModeratorGuard],
})
export class ModerationModule {}
