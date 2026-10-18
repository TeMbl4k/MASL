import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { karmaEventsResponse, type KarmaEventsResponse } from '@masl/shared';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { KarmaService } from './karma.service.js';

@Controller('me')
@UseGuards(AuthGuard, RateLimitGuard)
export class KarmaController {
  constructor(@Inject(KarmaService) private readonly karma: KarmaService) {}

  /** The caller's latest karma changes, newest first. */
  @Get('karma-events')
  @RateLimit('lobbyRead')
  @ResponseSchema(karmaEventsResponse)
  async events(@CurrentUserId() userId: string): Promise<KarmaEventsResponse> {
    return { items: await this.karma.listForUser(userId) };
  }
}
