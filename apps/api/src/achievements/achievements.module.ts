import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { AchievementsController } from './achievements.controller.js';
import { AchievementsService } from './achievements.service.js';

/** Achievements and the friends who reached a meetup (stage 7). */
@Module({
  imports: [SessionModule],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
