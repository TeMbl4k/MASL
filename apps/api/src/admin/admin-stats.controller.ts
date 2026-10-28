import { Body, Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
import {
  adminStatsDto,
  adminStatsQuery,
  adminTeamResponse,
  linkTagInput,
  linkTagsResponse,
  type AdminStatsDto,
  type AdminStatsQuery,
  type AdminTeamResponse,
  type LinkTagInput,
  type LinkTagsResponse,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { StatsService } from './stats.service.js';
import { TeamService } from './team.service.js';

/** Admins only: statistics, the team and link tags. */
@Controller('admin')
@UseGuards(AuthGuard, AdminGuard, RateLimitGuard)
export class AdminStatsController {
  constructor(
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(TeamService) private readonly team: TeamService,
  ) {}

  @Get('stats')
  @RateLimit('moderationRead')
  @ResponseSchema(adminStatsDto)
  statistics(@Query(new ZodValidationPipe(adminStatsQuery)) query: AdminStatsQuery): Promise<AdminStatsDto> {
    return this.stats.stats(query);
  }

  @Get('team')
  @RateLimit('moderationRead')
  @ResponseSchema(adminTeamResponse)
  members(): Promise<AdminTeamResponse> {
    return this.team.team();
  }

  @Get('tags')
  @RateLimit('moderationRead')
  @ResponseSchema(linkTagsResponse)
  tags(): Promise<LinkTagsResponse> {
    return this.team.tags();
  }

  /** 201 with the whole list; 409 `tag_exists` for a taken slug. */
  @Post('tags')
  @RateLimit('moderationWrite')
  @ResponseSchema(linkTagsResponse)
  createTag(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(linkTagInput)) body: LinkTagInput,
  ): Promise<LinkTagsResponse> {
    return this.team.createTag(userId, body);
  }
}
