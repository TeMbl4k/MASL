import {
  Inject,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { map, type Observable } from 'rxjs';
import type { ZodType, core } from 'zod';
import { apiError } from '../errors/api-error.js';
import { routePattern } from '../errors/request-route.js';
import { RESPONSE_SCHEMA } from './response-schema.decorator.js';

/** Issue locations without values; unknown keys are named, since a strict schema refused them. */
function issuePaths(issues: readonly core.$ZodIssue[]): string[] {
  const paths = issues.flatMap((issue) => {
    const base = issue.path.map(String);
    const keys = issue.code === 'unrecognized_keys' ? issue.keys : [null];
    return keys.map((key) => [...base, ...(key === null ? [] : [key])].join('.') || '(корень)');
  });
  return [...new Set(paths)];
}

/**
 * Fails closed: a response that doesn't match its shared schema (an extra key on a strict
 * object, e.g. an exact address on a public card) becomes a 500 instead of a disclosure.
 * Handlers without @ResponseSchema pass through untouched.
 */
@Injectable()
export class ResponseSchemaInterceptor implements NestInterceptor {
  private readonly log = new Logger('ResponseSchema');

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<ZodType | undefined>(RESPONSE_SCHEMA, context.getHandler());
    if (!schema) {
      return next.handle();
    }
    const http = context.switchToHttp();
    return next.handle().pipe(
      map((data: unknown) => {
        const result = schema.safeParse(data);
        if (!result.success) {
          const route = routePattern(http.getRequest<FastifyRequest>());
          this.log.error(`Ответ ${route} не прошёл схему: ${issuePaths(result.error.issues).join(', ')}`);
          throw apiError('internal_error');
        }
        http.getResponse<FastifyReply>().header('Cache-Control', 'private, no-store');
        return result.data;
      }),
    );
  }
}
