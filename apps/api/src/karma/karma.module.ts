import { Module } from '@nestjs/common';
import { KarmaService } from './karma.service.js';

@Module({
  providers: [KarmaService],
  exports: [KarmaService],
})
export class KarmaModule {}
