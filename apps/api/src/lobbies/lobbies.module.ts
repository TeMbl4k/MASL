import { Module } from '@nestjs/common';
import { KarmaModule } from '../karma/karma.module.js';
import { SessionModule } from '../session/session.module.js';

/** Lobbies, applications, feed and map. */
@Module({
  imports: [SessionModule, KarmaModule],
})
export class LobbiesModule {}
