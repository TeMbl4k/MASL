import { Body, Controller, Get, HttpCode, Inject, Post, Put, UseGuards } from '@nestjs/common';
import {
  acceptTermsInput,
  arrivalInput,
  arrivalResponse,
  meDto,
  onboardingInput,
  privacyInput,
  updateInterestsInput,
  type AcceptTermsInput,
  type ArrivalInput,
  type ArrivalResponse,
  type MeDto,
  type OnboardingInput,
  type PrivacyInput,
  type UpdateInterestsInput,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { UsersService } from './users.service.js';

@Controller('me')
@UseGuards(AuthGuard, RateLimitGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @ResponseSchema(meDto)
  me(@CurrentUserId() userId: string): Promise<MeDto> {
    return this.users.getMe(userId);
  }

  /** Accepts the user agreement; required before onboarding and on every new version. */
  @Put('terms')
  @RateLimit('lobbyWrite')
  @ResponseSchema(meDto)
  acceptTerms(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(acceptTermsInput)) body: AcceptTermsInput,
  ): Promise<MeDto> {
    return this.users.acceptTerms(userId, body);
  }

  /** Repeatable (it replaces the interests), so it shares the write limit of PUT /me/interests. */
  @Put('onboarding')
  @RateLimit('lobbyWrite')
  @ResponseSchema(meDto)
  onboarding(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(onboardingInput)) body: OnboardingInput,
  ): Promise<MeDto> {
    return this.users.completeOnboarding(userId, body);
  }

  /** Replaces the caller's interests; the user comes only from the session. */
  @Put('interests')
  @RateLimit('lobbyWrite')
  @ResponseSchema(meDto)
  interests(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(updateInterestsInput)) body: UpdateInterestsInput,
  ): Promise<MeDto> {
    return this.users.updateInterests(userId, body);
  }

  /** «Не показывать меня в поиске» and «Приглашения на встречи». */
  @Put('privacy')
  @RateLimit('lobbyWrite')
  @ResponseSchema(meDto)
  privacy(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(privacyInput)) body: PrivacyInput,
  ): Promise<MeDto> {
    return this.users.updatePrivacy(userId, body);
  }

  /**
   * The start parameter the app was opened with, sent once after sign-in: a new user's first
   * link becomes their source. Before onboarding too, so the source isn't lost.
   */
  @Post('arrival')
  @HttpCode(200)
  @RateLimit('lobbyWrite')
  @ResponseSchema(arrivalResponse)
  arrival(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(arrivalInput)) body: ArrivalInput,
  ): Promise<ArrivalResponse> {
    return this.users.recordArrival(userId, body.startParam);
  }
}
