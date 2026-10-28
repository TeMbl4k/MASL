import {
  createParamDecorator,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { users, type Database } from '@masl/db';
import type { UserRole } from '@masl/shared';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { userRole } from './roles.js';

interface ModeratorRequest extends FastifyRequest {
  userId?: string;
  moderationRole?: Exclude<UserRole, 'user'>;
}

/**
 * Lets moderators and admins through, 403 `forbidden_moderation` for everyone else. Runs after
 * AuthGuard and reads the role on every request, not from the session token, so a revoked
 * moderator loses access at once.
 */
@Injectable()
export class ModeratorGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ModeratorRequest>();
    const role = await requestRole(this.db, this.env, request);
    if (role === 'user') throw apiError('forbidden_moderation');
    request.moderationRole = role;
    return true;
  }
}

/** Admins only (stage 6: statistics, feedback, the team and link tags), 403 `admin_section`. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ModeratorRequest>();
    const role = await requestRole(this.db, this.env, request);
    if (role !== 'admin') throw apiError(role === 'user' ? 'forbidden_moderation' : 'admin_section');
    request.moderationRole = role;
    return true;
  }
}

/** The role of the request's user, read fresh; runs after AuthGuard. */
async function requestRole(db: Database, env: Env, request: ModeratorRequest): Promise<UserRole> {
  if (!request.userId) throw new UnauthorizedException('Нужна авторизация');
  const [user] = await db
    .select({ telegramId: users.telegramId, isModerator: users.isModerator })
    .from(users)
    .where(eq(users.id, request.userId));
  return user ? userRole(user, env.ADMIN_TELEGRAM_IDS) : 'user';
}

/** The viewer is an admin; use only together with ModeratorGuard. */
export const ViewerIsAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): boolean =>
    context.switchToHttp().getRequest<ModeratorRequest>().moderationRole === 'admin',
);
