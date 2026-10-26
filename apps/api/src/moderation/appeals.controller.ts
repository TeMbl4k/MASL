import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { appealInput, appealStateDto, type AppealInput, type AppealStateDto } from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { AppealsService } from './appeals.service.js';

/** The caller's creation block and appeal; the user comes only from the session. */
@Controller('me')
@UseGuards(AuthGuard, RateLimitGuard)
export class AppealsController {
  constructor(@Inject(AppealsService) private readonly appeals: AppealsService) {}

  @Get('appeal')
  @ResponseSchema(appealStateDto)
  state(@CurrentUserId() userId: string): Promise<AppealStateDto> {
    return this.appeals.state(userId);
  }

  @Post('appeals')
  @HttpCode(200)
  @RateLimit('appealWrite')
  @ResponseSchema(appealStateDto)
  submit(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(appealInput)) body: AppealInput,
  ): Promise<AppealStateDto> {
    return this.appeals.submit(userId, body);
  }
}
