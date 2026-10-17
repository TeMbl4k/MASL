import { Body, Controller, Get, Inject, Post, Res, UseGuards } from '@nestjs/common';
import {
  createLobbyInput,
  creationContextDto,
  lobbyDetailDto,
  type CreateLobbyInput,
  type CreationContextDto,
  type LobbyDetailDto,
} from '@masl/shared';
import type { FastifyReply } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { LobbiesService } from './lobbies.service.js';

@Controller('lobbies')
@UseGuards(AuthGuard, RateLimitGuard)
export class LobbiesController {
  constructor(@Inject(LobbiesService) private readonly lobbies: LobbiesService) {}

  /** Whether the caller can create a lobby now, and the wizard's options. */
  @Get('creation-context')
  @RateLimit('lobbyRead')
  @ResponseSchema(creationContextDto)
  creationContext(@CurrentUserId() userId: string): Promise<CreationContextDto> {
    return this.lobbies.creationContext(userId);
  }

  /** 201 with the host's detail; 200 with the first lobby on a repeated requestId. */
  @Post()
  @RateLimit('lobbyWrite')
  @ResponseSchema(lobbyDetailDto)
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createLobbyInput)) body: CreateLobbyInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LobbyDetailDto> {
    const { created, lobby } = await this.lobbies.create(userId, body);
    reply.status(created ? 201 : 200);
    return lobby;
  }
}
