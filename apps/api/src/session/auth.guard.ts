import {
  createParamDecorator,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TokenService } from './token.service.js';

interface AuthenticatedRequest extends FastifyRequest {
  userId?: string;
}

/** Пропускает запрос только с действующим Bearer-токеном сессии. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new UnauthorizedException('Нужна авторизация');
    }
    const userId = await this.tokens.verify(match[1]);
    if (!userId) {
      throw new UnauthorizedException('Сессия недействительна или истекла');
    }
    request.userId = userId;
    return true;
  }
}

/** id текущего пользователя; использовать только вместе с AuthGuard. */
export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.userId) {
    throw new UnauthorizedException('Нужна авторизация');
  }
  return request.userId;
});
