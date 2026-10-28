import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  adminSupportDto,
  adminSupportQuery,
  adminSupportResponse,
  idParam,
  supportInput,
  supportReplyInput,
  supportResponse,
  type AdminSupportDto,
  type AdminSupportQuery,
  type AdminSupportResponse,
  type SupportInput,
  type SupportReplyInput,
  type SupportResponse,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { SupportService } from './support.service.js';

@Controller('me/support')
@UseGuards(AuthGuard, RateLimitGuard)
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  /** «Написать нам»: the author gets no list back, only the bot's reply later. */
  @Post()
  @HttpCode(200)
  @RateLimit('supportWrite')
  @ResponseSchema(supportResponse)
  create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(supportInput)) body: SupportInput,
  ): Promise<SupportResponse> {
    return this.support.create(userId, body);
  }
}

/** «Обращения»: admins only. */
@Controller('admin/support')
@UseGuards(AuthGuard, AdminGuard, RateLimitGuard)
export class AdminSupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get()
  @RateLimit('moderationRead')
  @ResponseSchema(adminSupportResponse)
  list(
    @Query(new ZodValidationPipe(adminSupportQuery)) query: AdminSupportQuery,
  ): Promise<AdminSupportResponse> {
    return this.support.list(query);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @RateLimit('moderationWrite')
  @ResponseSchema(adminSupportDto)
  reply(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(supportReplyInput)) body: SupportReplyInput,
  ): Promise<AdminSupportDto> {
    return this.support.reply(userId, id, body.text);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RateLimit('moderationWrite')
  @ResponseSchema(adminSupportDto)
  close(@Param('id', new ZodValidationPipe(idParam)) id: string): Promise<AdminSupportDto> {
    return this.support.close(id);
  }
}
