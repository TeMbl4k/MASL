import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  adminCancelLobbyInput,
  adminCancelLobbyResponse,
  adminCaseDto,
  adminCasesQuery,
  adminCasesResponse,
  idParam,
  resolveCaseInput,
  type AdminCancelLobbyInput,
  type AdminCancelLobbyResponse,
  type AdminCaseDto,
  type AdminCasesQuery,
  type AdminCasesResponse,
  type ResolveCaseInput,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { ModerationService } from './moderation.service.js';
import { ModeratorGuard } from './moderator.guard.js';

/** The moderation queue, case decisions and the moderator's lobby cancel. */
@Controller('admin')
@UseGuards(AuthGuard, ModeratorGuard, RateLimitGuard)
export class AdminController {
  constructor(@Inject(ModerationService) private readonly moderation: ModerationService) {}

  @Get('cases')
  @RateLimit('moderationRead')
  @ResponseSchema(adminCasesResponse)
  cases(@Query(new ZodValidationPipe(adminCasesQuery)) query: AdminCasesQuery): Promise<AdminCasesResponse> {
    return this.moderation.queue(query);
  }

  @Get('cases/:id')
  @RateLimit('moderationRead')
  @ResponseSchema(adminCaseDto)
  case(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<AdminCaseDto> {
    return this.moderation.detail(userId, id);
  }

  @Post('cases/:id/resolve')
  @HttpCode(200)
  @RateLimit('moderationWrite')
  @ResponseSchema(adminCaseDto)
  resolve(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(resolveCaseInput)) body: ResolveCaseInput,
  ): Promise<AdminCaseDto> {
    return this.moderation.resolve(userId, id, body);
  }

  @Post('lobbies/:id/cancel')
  @HttpCode(200)
  @RateLimit('moderationWrite')
  @ResponseSchema(adminCancelLobbyResponse)
  cancelLobby(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(adminCancelLobbyInput)) body: AdminCancelLobbyInput,
  ): Promise<AdminCancelLobbyResponse> {
    return this.moderation.cancelLobby(userId, id, body);
  }
}
