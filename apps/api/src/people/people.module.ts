import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module.js';
import { LobbiesModule } from '../lobbies/lobbies.module.js';
import { SessionModule } from '../session/session.module.js';
import { PeopleController } from './people.controller.js';
import { PeopleService } from './people.service.js';
import { ShareService } from './share.service.js';

/** Public profiles, companions and sharing (stage 6). */
@Module({
  imports: [SessionModule, LobbiesModule, BotModule],
  controllers: [PeopleController],
  providers: [PeopleService, ShareService],
})
export class PeopleModule {}
