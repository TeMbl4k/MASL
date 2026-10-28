import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { SessionModule } from '../session/session.module.js';
import { AdminTagQrController, CardController } from './qr.controller.js';
import { QrService } from './qr.service.js';

/** QR files to print: the personal card and the admins' link tags (stage 7). */
@Module({
  imports: [SessionModule, BotModule],
  controllers: [CardController, AdminTagQrController],
  providers: [QrService, AdminGuard],
})
export class QrModule {}
