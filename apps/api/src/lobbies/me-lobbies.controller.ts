import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { myLobbiesResponse, type MyLobbiesResponse } from '@masl/shared';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { FeedService } from './feed.service.js';

@Controller('me')
@UseGuards(AuthGuard, RateLimitGuard)
export class MeLobbiesController {
  constructor(@Inject(FeedService) private readonly feeds: FeedService) {}

  /** «Мои события»: the caller's hosted and joined lobbies, upcoming and past. */
  @Get('lobbies')
  @RateLimit('lobbyRead')
  @ResponseSchema(myLobbiesResponse)
  myLobbies(@CurrentUserId() userId: string): Promise<MyLobbiesResponse> {
    return this.feeds.myLobbies(userId);
  }
}
