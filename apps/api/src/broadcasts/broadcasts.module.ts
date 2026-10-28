import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { SessionModule } from '../session/session.module.js';
import { BroadcastsController } from './broadcasts.controller.js';
import { BroadcastsService } from './broadcasts.service.js';

/** The admin's broadcasts and «Отписаться от новостей» (stage 7). */
@Module({
  imports: [SessionModule, BotModule],
  controllers: [BroadcastsController],
  providers: [BroadcastsService, AdminGuard],
  exports: [BroadcastsService],
})
export class BroadcastsModule {}
