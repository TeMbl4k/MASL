import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  adminUserCardDto,
  adminUserSearchQuery,
  adminUserSearchResponse,
  idParam,
  userActionInput,
  type AdminUserCardDto,
  type AdminUserSearchQuery,
  type AdminUserSearchResponse,
  type UserActionInput,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { AdminUsersService } from './admin-users.service.js';
import { ModeratorGuard, ViewerIsAdmin } from './moderator.guard.js';

/** User search, the user card and the moderator's actions on a user. */
@Controller('admin/users')
@UseGuards(AuthGuard, ModeratorGuard, RateLimitGuard)
export class AdminUsersController {
  constructor(@Inject(AdminUsersService) private readonly users: AdminUsersService) {}

  @Get()
  @RateLimit('moderationRead')
  @ResponseSchema(adminUserSearchResponse)
  search(
    @Query(new ZodValidationPipe(adminUserSearchQuery)) query: AdminUserSearchQuery,
  ): Promise<AdminUserSearchResponse> {
    return this.users.search(query);
  }

  @Get(':id')
  @RateLimit('moderationRead')
  @ResponseSchema(adminUserCardDto)
  card(
    @CurrentUserId() viewerId: string,
    @ViewerIsAdmin() viewerIsAdmin: boolean,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<AdminUserCardDto> {
    return this.users.card(viewerId, id, viewerIsAdmin);
  }

  @Post(':id/actions')
  @HttpCode(200)
  @RateLimit('moderationWrite')
  @ResponseSchema(adminUserCardDto)
  act(
    @CurrentUserId() viewerId: string,
    @ViewerIsAdmin() viewerIsAdmin: boolean,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(userActionInput)) body: UserActionInput,
  ): Promise<AdminUserCardDto> {
    return this.users.act(viewerId, id, viewerIsAdmin, body);
  }
}
