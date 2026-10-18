import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { BotHandlersModule } from './bot/bot-handlers.module.js';
import { ClockModule } from './clock/clock.module.js';
import { EnvModule } from './config/env.module.js';
import type { Env } from './config/env.js';
import { ResponseSchemaInterceptor } from './contracts/response-schema.interceptor.js';
import { DbModule } from './db/db.module.js';
import { RedactingExceptionFilter } from './errors/redacting-exception.filter.js';
import { HealthController } from './health/health.controller.js';
import { InterestsModule } from './interests/interests.module.js';
import { KarmaModule } from './karma/karma.module.js';
import { LobbiesModule } from './lobbies/lobbies.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { PlacesModule } from './places/places.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { UsersModule } from './users/users.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        DbModule,
        ClockModule,
        RateLimitModule,
        AuthModule,
        UsersModule,
        InterestsModule,
        KarmaModule,
        LobbiesModule,
        ModerationModule,
        PlacesModule,
        BotHandlersModule,
      ],
      controllers: [HealthController],
      providers: [
        // Global, so every route (the stage 1 controllers too) gets redacted error logs.
        { provide: APP_FILTER, useClass: RedactingExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseSchemaInterceptor },
      ],
    };
  }
}
