import { Body, Controller, Get, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  createLobbyInput,
  creationContextDto,
  idParam,
  lobbyDetailDto,
  lobbyDetailQuery,
  type CreateLobbyInput,
  type CreationContextDto,
  type LobbyDetailDto,
  type LobbyDetailQuery,
} from '@masl/shared';
import type { GeoPoint } from '@masl/db';
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

  /** The lobby as the caller may see it; 404 for a missing or hidden one. */
  @Get(':id')
  @RateLimit('lobbyRead')
  @ResponseSchema(lobbyDetailDto)
  detail(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Query(new ZodValidationPipe(lobbyDetailQuery)) query: LobbyDetailQuery,
  ): Promise<LobbyDetailDto> {
    return this.lobbies.detail(userId, id, originOf(query));
  }
}

/** The viewer origin of a query; the schema already rounded it and requires both or neither. */
export function originOf(query: { lat?: number; lng?: number }): GeoPoint | null {
  return query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : null;
}
