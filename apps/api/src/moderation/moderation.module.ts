import { Module } from '@nestjs/common';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { SessionModule } from '../session/session.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Reports, moderation cases, appeals and the moderators' tools (stage 4). */
@Module({
  imports: [SessionModule, LobbiesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ModerationModule {}
