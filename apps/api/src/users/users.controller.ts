import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { onboardingInput, type MeDto, type OnboardingInput } from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { UsersService } from './users.service.js';

@Controller('me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  me(@CurrentUserId() userId: string): Promise<MeDto> {
    return this.users.getMe(userId);
  }

  @Put('onboarding')
  onboarding(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(onboardingInput)) body: OnboardingInput,
  ): Promise<MeDto> {
    return this.users.completeOnboarding(userId, body);
  }
}
