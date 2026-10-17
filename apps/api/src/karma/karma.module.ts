import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { KarmaController } from './karma.controller.js';
import { KarmaService } from './karma.service.js';

@Module({
  imports: [SessionModule],
  controllers: [KarmaController],
  providers: [KarmaService],
  exports: [KarmaService],
})
export class KarmaModule {}
