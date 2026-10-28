import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { SessionModule } from '../session/session.module.js';
import { AdminSupportController, SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';

/** «Написать нам» and the admins' «Обращения» (stage 6). */
@Module({
  imports: [SessionModule, LobbiesModule, BotModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, AdminGuard],
})
export class SupportModule {}
