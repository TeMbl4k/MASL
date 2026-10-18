import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  cancelLobbyInput,
  chatPrepareInput,
  chatPrepareResponse,
  createLobbyInput,
  creationContextDto,
  feedQuery,
  feedResponse,
  idParam,
  lobbyDetailDto,
  lobbyDetailQuery,
  mapQuery,
  mapResponse,
  type CancelLobbyInput,
  type ChatPrepareInput,
  type ChatPrepareResponse,
  type CreateLobbyInput,
  type CreationContextDto,
  type FeedQuery,
  type FeedResponse,
  type LobbyDetailDto,
  type LobbyDetailQuery,
  type MapQuery,
  type MapResponse,
} from '@masl/shared';
import type { FastifyReply } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { ChatService } from './chat.service.js';
import { FeedService } from './feed.service.js';
import { LobbiesService } from './lobbies.service.js';
import { originOf } from './lobby-queries.js';

@Controller('lobbies')
@UseGuards(AuthGuard, RateLimitGuard)
export class LobbiesController {
  constructor(
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(FeedService) private readonly feeds: FeedService,
    @Inject(ChatService) private readonly chats: ChatService,
  ) {}

  /** «Для вас»: discoverable lobbies of all Moscow, ranked; keyset-paged by `cursor`. */
  @Get('feed')
  @RateLimit('lobbyRead')
  @ResponseSchema(feedResponse)
  feed(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(feedQuery)) query: FeedQuery,
  ): Promise<FeedResponse> {
    return this.feeds.feed(userId, query);
  }

  /** Discoverable lobbies grouped by metro station. */
  @Get('map')
  @RateLimit('lobbyRead')
  @ResponseSchema(mapResponse)
  map(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(mapQuery)) query: MapQuery,
  ): Promise<MapResponse> {
    return this.feeds.map(userId, query);
  }

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

  /** Host cancel before the start, with a reason; 200 also on a repeat. */
  @Post(':id/cancel')
  @HttpCode(200)
  @RateLimit('lobbyWrite')
  @ResponseSchema(lobbyDetailDto)
  cancel(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(cancelLobbyInput)) body: CancelLobbyInput,
  ): Promise<LobbyDetailDto> {
    return this.lobbies.cancel(userId, id, body);
  }

  /** Host: a group picker button for «Создать чат встречи» (WebApp.requestChat or the bot's chat). */
  @Post(':id/chat/prepare')
  @HttpCode(200)
  @RateLimit('lobbyWrite')
  @ResponseSchema(chatPrepareResponse)
  prepareChat(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(chatPrepareInput)) body: ChatPrepareInput,
  ): Promise<ChatPrepareResponse> {
    return this.chats.prepare(userId, id, body);
  }
}
