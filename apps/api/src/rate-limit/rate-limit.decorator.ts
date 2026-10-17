import { SetMetadata } from '@nestjs/common';
import type { RateLimitBucket } from '@masl/shared';

export const RATE_LIMIT_BUCKETS = 'masl:rate-limit-buckets';

/**
 * Limits the handler per user with the given RATE_LIMITS buckets (all must have room).
 * Needs RateLimitGuard after AuthGuard on the controller.
 */
export const RateLimit = (...buckets: [RateLimitBucket, ...RateLimitBucket[]]) =>
  SetMetadata(RATE_LIMIT_BUCKETS, buckets);
