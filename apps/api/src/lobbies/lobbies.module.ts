import { Module } from '@nestjs/common';
import { KarmaModule } from '../karma/karma.module.js';
import { SessionModule } from '../session/session.module.js';
import { FeedService } from './feed.service.js';
import { LobbiesController } from './lobbies.controller.js';
import { LobbiesService } from './lobbies.service.js';
import { MeLobbiesController } from './me-lobbies.controller.js';

/** Lobbies, applications, feed and map. */
@Module({
  imports: [SessionModule, KarmaModule],
  controllers: [LobbiesController, MeLobbiesController],
  providers: [LobbiesService, FeedService],
  exports: [LobbiesService],
})
export class LobbiesModule {}
