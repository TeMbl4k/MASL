import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { meDto, onboardingInput, type MeDto, type OnboardingInput } from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
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

  @Put('onboarding')
  @ResponseSchema(meDto)
  onboarding(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(onboardingInput)) body: OnboardingInput,
  ): Promise<MeDto> {
    return this.users.completeOnboarding(userId, body);
  }
}
