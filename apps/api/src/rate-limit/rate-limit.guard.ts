import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMITS, type RateLimitBucket } from '@masl/shared';
import type { FastifyReply } from 'fastify';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { apiError } from '../errors/api-error.js';
import { RATE_LIMIT_BUCKETS } from './rate-limit.decorator.js';
import { FixedWindowStore } from './fixed-window.store.js';

/**
 * Per-user request limits from @RateLimit buckets, keyed `bucket:userId`. Runs after AuthGuard,
 * which sets request.userId; handlers without @RateLimit pass.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(FixedWindowStore) private readonly store: FixedWindowStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const buckets = this.reflector.get<RateLimitBucket[] | undefined>(
      RATE_LIMIT_BUCKETS,
      context.getHandler(),
    );
    if (!buckets?.length) {
      return true;
    }
    const http = context.switchToHttp();
    const { userId } = http.getRequest<{ userId?: string }>();
    if (!userId) {
      throw new UnauthorizedException('Нужна авторизация');
    }
    const result = this.store.take(
      buckets.map((bucket) => ({
        key: `${bucket}:${userId}`,
        limit: RATE_LIMITS[bucket].limit,
        windowMs: RATE_LIMITS[bucket].windowSeconds * 1000,
      })),
      this.clock.now().getTime(),
    );
    if (!result.allowed) {
      http.getResponse<FastifyReply>().header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      throw apiError('rate_limited');
    }
    return true;
  }
}
