import { Global, Module } from '@nestjs/common';
import { FixedWindowStore } from './fixed-window.store.js';
import { RateLimitGuard } from './rate-limit.guard.js';

@Global()
@Module({
  providers: [{ provide: FixedWindowStore, useFactory: () => new FixedWindowStore() }, RateLimitGuard],
  exports: [FixedWindowStore, RateLimitGuard],
})
export class RateLimitModule {}
