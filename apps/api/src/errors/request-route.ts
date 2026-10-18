import type { FastifyRequest } from 'fastify';

/**
 * "GET /api/lobbies/:id": the matched route pattern for logs. Never request.url: the query
 * carries viewer coordinates.
 */
export function routePattern(request: Pick<FastifyRequest, 'method' | 'routeOptions'>): string {
  return `${request.method} ${request.routeOptions?.url ?? '(маршрут не найден)'}`;
}
