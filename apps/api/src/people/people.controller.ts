import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  companionsResponse,
  personCodeParam,
  publicProfileDto,
  shareInput,
  shareResponse,
  type CompanionsResponse,
  type PublicProfileDto,
  type ShareInput,
  type ShareResponse,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { PeopleService } from './people.service.js';
import { ShareService } from './share.service.js';

@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
export class PeopleController {
  constructor(
    @Inject(PeopleService) private readonly people: PeopleService,
    @Inject(ShareService) private readonly shares: ShareService,
  ) {}

  /** A public profile by its public code; 404 for a hidden or unknown person. */
  @Get('people/:code')
  @RateLimit('lobbyRead')
  @ResponseSchema(publicProfileDto)
  profile(
    @CurrentUserId() userId: string,
    @Param('code', new ZodValidationPipe(personCodeParam)) code: string,
  ): Promise<PublicProfileDto> {
    return this.people.profile(userId, code);
  }

  /** «Напарники»: visible to their owner only. */
  @Get('me/companions')
  @RateLimit('lobbyRead')
  @ResponseSchema(companionsResponse)
  companions(@CurrentUserId() userId: string): Promise<CompanionsResponse> {
    return this.people.companions(userId);
  }

  /** A link and a prepared card to share a lobby or profile the caller can see. */
  @Post('share')
  @HttpCode(200)
  @RateLimit('share')
  @ResponseSchema(shareResponse)
  share(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(shareInput)) body: ShareInput,
  ): Promise<ShareResponse> {
    return this.shares.share(userId, body);
  }
}
