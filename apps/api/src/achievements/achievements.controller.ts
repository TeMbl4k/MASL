import { Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  achievementsSeenResponse,
  myAchievementsResponse,
  type AchievementsSeenResponse,
  type MyAchievementsResponse,
} from '@masl/shared';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { AchievementsService } from './achievements.service.js';

@Controller('me/achievements')
@UseGuards(AuthGuard, RateLimitGuard)
export class AchievementsController {
  constructor(@Inject(AchievementsService) private readonly achievements: AchievementsService) {}

  /** The caller's achievements with progress and the numbers of their friends. */
  @Get()
  @RateLimit('lobbyRead')
  @ResponseSchema(myAchievementsResponse)
  mine(@CurrentUserId() userId: string): Promise<MyAchievementsResponse> {
    return this.achievements.mine(userId);
  }

  @Post('seen')
  @HttpCode(200)
  @RateLimit('lobbyWrite')
  @ResponseSchema(achievementsSeenResponse)
  seen(@CurrentUserId() userId: string): Promise<AchievementsSeenResponse> {
    return this.achievements.markSeen(userId);
  }
}
