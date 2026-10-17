import { Module } from '@nestjs/common';
import { KarmaModule } from '../karma/karma.module.js';
import { SessionModule } from '../session/session.module.js';
import { LobbiesController } from './lobbies.controller.js';
import { LobbiesService } from './lobbies.service.js';

/** Lobbies, applications, feed and map. */
@Module({
  imports: [SessionModule, KarmaModule],
  controllers: [LobbiesController],
  providers: [LobbiesService],
  exports: [LobbiesService],
})
export class LobbiesModule {}
