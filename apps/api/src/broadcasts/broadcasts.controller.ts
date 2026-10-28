import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  broadcastAudienceDto,
  broadcastAudienceInput,
  broadcastInput,
  broadcastsResponse,
  broadcastTestResponse,
  type BroadcastAudienceDto,
  type BroadcastAudienceInput,
  type BroadcastInput,
  type BroadcastsResponse,
  type BroadcastTestResponse,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { BroadcastsService } from './broadcasts.service.js';

/** «Рассылки»: admins only; moderators get 403 like the other admin sections. */
@Controller('admin/broadcasts')
@UseGuards(AuthGuard, AdminGuard, RateLimitGuard)
export class BroadcastsController {
  constructor(@Inject(BroadcastsService) private readonly broadcasts: BroadcastsService) {}

  @Get()
  @RateLimit('moderationRead')
  @ResponseSchema(broadcastsResponse)
  list(): Promise<BroadcastsResponse> {
    return this.broadcasts.list();
  }

  /** How many a broadcast to this audience would reach now. */
  @Post('audience')
  @HttpCode(200)
  @RateLimit('moderationRead')
  @ResponseSchema(broadcastAudienceDto)
  audience(
    @Body(new ZodValidationPipe(broadcastAudienceInput)) body: BroadcastAudienceInput,
  ): Promise<BroadcastAudienceDto> {
    return this.broadcasts.audience(body.interests);
  }

  @Post('test')
  @HttpCode(200)
  @RateLimit('broadcastTest')
  @ResponseSchema(broadcastTestResponse)
  test(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(broadcastInput)) body: BroadcastInput,
  ): Promise<BroadcastTestResponse> {
    return this.broadcasts.test(userId, body);
  }

  /** 201 with the history; the messages go out through the bot's queue. */
  @Post()
  @RateLimit('broadcastWrite')
  @ResponseSchema(broadcastsResponse)
  send(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(broadcastInput)) body: BroadcastInput,
  ): Promise<BroadcastsResponse> {
    return this.broadcasts.send(userId, body);
  }
}
