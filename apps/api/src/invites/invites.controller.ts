import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  idParam,
  inviteAnswerResponse,
  inviteCandidatesQuery,
  inviteCandidatesResponse,
  myInvitesResponse,
  sendInvitesInput,
  sendInvitesResponse,
  type InviteAnswerResponse,
  type InviteCandidatesQuery,
  type InviteCandidatesResponse,
  type MyInvitesResponse,
  type SendInvitesInput,
  type SendInvitesResponse,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { InvitesService } from './invites.service.js';

@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
export class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  /** People to invite: a search by name or @username, or the caller's companions. */
  @Get('lobbies/:id/invite-candidates')
  @RateLimit('lobbyRead')
  @ResponseSchema(inviteCandidatesResponse)
  candidates(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) lobbyId: string,
    @Query(new ZodValidationPipe(inviteCandidatesQuery)) query: InviteCandidatesQuery,
  ): Promise<InviteCandidatesResponse> {
    return this.invites.candidates(userId, lobbyId, query);
  }

  /** The host or an approved member invites people by their public codes. */
  @Post('lobbies/:id/invites')
  @HttpCode(200)
  @RateLimit('inviteWrite')
  @ResponseSchema(sendInvitesResponse)
  send(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) lobbyId: string,
    @Body(new ZodValidationPipe(sendInvitesInput)) body: SendInvitesInput,
  ): Promise<SendInvitesResponse> {
    return this.invites.send(userId, lobbyId, body);
  }

  /** The caller's own invites only. */
  @Get('me/invites')
  @RateLimit('lobbyRead')
  @ResponseSchema(myInvitesResponse)
  mine(@CurrentUserId() userId: string): Promise<MyInvitesResponse> {
    return this.invites.mine(userId);
  }

  @Post('me/invites/:id/accept')
  @HttpCode(200)
  @RateLimit('applicationWrite')
  @ResponseSchema(inviteAnswerResponse)
  accept(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) inviteId: string,
  ): Promise<InviteAnswerResponse> {
    return this.invites.accept(userId, inviteId);
  }

  @Post('me/invites/:id/decline')
  @HttpCode(200)
  @RateLimit('applicationWrite')
  @ResponseSchema(inviteAnswerResponse)
  decline(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) inviteId: string,
  ): Promise<InviteAnswerResponse> {
    return this.invites.decline(userId, inviteId);
  }
}
