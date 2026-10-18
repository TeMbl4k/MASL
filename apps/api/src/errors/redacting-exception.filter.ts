import { Catch, HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { ApiErrorCode, ApiErrorDto } from '@masl/shared';
import type { FastifyRequest } from 'fastify';
import { apiError } from './api-error.js';
import { routePattern } from './request-route.js';

/** What may be logged about an unexpected error: no message, params, detail or stack. */
export interface RedactedError {
  name: string;
  pgCode: string | null;
  constraint: string | null;
}

const PG_CODE = /^[0-9A-Z]{5}$/;

/**
 * Error class name plus the code and constraint of the PostgresError found through `cause`
 * (Drizzle wraps the driver error in DrizzleQueryError). The message is never read:
 * DrizzleQueryError puts query params into it and PostgreSQL details hold whole rows.
 */
export function redactError(error: unknown): RedactedError {
  // DrizzleQueryError keeps the default name 'Error'; its class name is the useful part.
  const name =
    error instanceof Error ? (error.name !== 'Error' ? error.name : error.constructor.name) : typeof error;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    const { code, constraint_name: constraintName, constraint } = current as Record<string, unknown>;
    // Only postgres.js errors carry a SQLSTATE; Node codes such as EPIPE have the same shape.
    if (
      current instanceof Error &&
      current.name === 'PostgresError' &&
      typeof code === 'string' &&
      PG_CODE.test(code)
    ) {
      const found = typeof constraintName === 'string' ? constraintName : constraint;
      return { name, pgCode: code, constraint: typeof found === 'string' ? found : null };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return { name, pgCode: null, constraint: null };
}

/** One log line for an unexpected error, in the redacted shape. */
export function formatRedacted(where: string, info: RedactedError): string {
  return `Ошибка ${where}: ${info.name}, pgCode=${info.pgCode ?? '-'}, constraint=${info.constraint ?? '-'}`;
}

/** Response code for an unexpected error: known PostgreSQL races and checks, else a plain 500. */
function codeFor(pgCode: string | null): ApiErrorCode {
  switch (pgCode) {
    case '23505':
      return 'conflict';
    case '23514':
      return 'invalid_data';
    case '40P01':
    case '40001':
      return 'retry';
    default:
      return 'internal_error';
  }
}

/**
 * Global filter. HttpExceptions keep Nest's behaviour (Fastify client errors such as malformed
 * JSON reach it as HttpExceptions too); anything else is logged in the redacted shape with the
 * route pattern and answered with an apiErrorDto body.
 */
@Catch()
export class RedactingExceptionFilter extends BaseExceptionFilter {
  private readonly log = new Logger('Errors');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException || host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }
    const http = host.switchToHttp();
    const info = redactError(exception);
    this.log.error(formatRedacted(routePattern(http.getRequest<FastifyRequest>()), info));
    const body: ApiErrorDto = apiError(codeFor(info.pgCode)).body;
    const adapter = this.applicationRef ?? this.httpAdapterHost?.httpAdapter;
    adapter!.reply(http.getResponse(), body, body.statusCode);
  }
}
