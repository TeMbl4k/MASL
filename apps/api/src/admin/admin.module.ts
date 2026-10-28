import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { SessionModule } from '../session/session.module.js';
import { AdminStatsController } from './admin-stats.controller.js';
import { StatsService } from './stats.service.js';
import { TeamService } from './team.service.js';

/** The admins' statistics, team and link tags (stage 6). */
@Module({
  imports: [SessionModule, BotModule],
  controllers: [AdminStatsController],
  providers: [StatsService, TeamService, AdminGuard],
})
export class AdminModule {}
