import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import {
  cancelApplicationResponse,
  hostApplicationsResponse,
  idParam,
  lobbyDetailDto,
  type CancelApplicationResponse,
  type HostApplicationsResponse,
  type LobbyDetailDto,
} from '@masl/shared';
import type { FastifyReply } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { ApplicationsService } from './applications.service.js';

@Controller('lobbies/:id/applications')
@UseGuards(AuthGuard, RateLimitGuard)
export class ApplicationsController {
  constructor(@Inject(ApplicationsService) private readonly applications: ApplicationsService) {}

  /** 201 for a new application, 200 while one is already pending or approved; the body is ignored. */
  @Post()
  @RateLimit('applicationWrite')
  @ResponseSchema(lobbyDetailDto)
  async apply(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LobbyDetailDto> {
    const { created, lobby } = await this.applications.apply(userId, id);
    reply.status(created ? 201 : 200);
    return lobby;
  }

  /** Withdraws the caller's own application or leaves the place; never another user's row. */
  @Delete('me')
  @HttpCode(200)
  @RateLimit('applicationWrite')
  @ResponseSchema(cancelApplicationResponse)
  cancelOwn(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<CancelApplicationResponse> {
    return this.applications.cancelOwn(userId, id);
  }

  /** The host's list of applications. */
  @Get()
  @RateLimit('lobbyRead')
  @ResponseSchema(hostApplicationsResponse)
  list(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<HostApplicationsResponse> {
    return this.applications.list(userId, id);
  }

  @Post(':applicationId/approve')
  @HttpCode(200)
  @RateLimit('hostDecision')
  @ResponseSchema(hostApplicationsResponse)
  approve(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Param('applicationId', new ZodValidationPipe(idParam)) applicationId: string,
  ): Promise<HostApplicationsResponse> {
    return this.applications.decide(userId, id, applicationId, 'approve');
  }

  @Post(':applicationId/reject')
  @HttpCode(200)
  @RateLimit('hostDecision')
  @ResponseSchema(hostApplicationsResponse)
  reject(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Param('applicationId', new ZodValidationPipe(idParam)) applicationId: string,
  ): Promise<HostApplicationsResponse> {
    return this.applications.decide(userId, id, applicationId, 'reject');
  }
}
