import { join, sep } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
// Только типы: добавляют reply.sendFile() из @fastify/static.
import type {} from '@fastify/static';

/** Общий префикс всех маршрутов API: Mini App и API живут на одном домене. */
export const API_PREFIX = 'api';

const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Браузер может хранить файл, но перед использованием перепроверяет (ETag → 304). */
const REVALIDATE = 'no-cache';

/**
 * Путь, который обслуживает клиентский роутер SvelteKit: не /api, не /_app
 * (файлы сборки) и без расширения в последнем сегменте. Поэтому /missing.js
 * или старый чанк /_app/immutable/x.js после деплоя получают честный 404,
 * а не index.html с кодом 200.
 */
export function isSpaRoute(url: string): boolean {
  const path = url.split('?', 1)[0] ?? '/';
  const api = `/${API_PREFIX}`;
  if (path === api || path.startsWith(`${api}/`)) {
    return false;
  }
  if (path === '/_app' || path.startsWith('/_app/')) {
    return false;
  }
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

/**
 * Отдаёт сборку Mini App (adapter-static) из того же Fastify, что и API.
 * Вызывать до app.init() / app.listen().
 */
export function serveSpa(app: NestFastifyApplication, root: string): void {
  const immutableDir = join(root, '_app', 'immutable') + sep;

  app.useStaticAssets({
    root,
    // Маршрут на каждый файл сборки, найденный при старте (и "/" для index.html).
    // Шаблон "/*" остаётся свободным для fallback ниже.
    wildcard: false,
    // Cache-Control ставим сами в setHeaders.
    cacheControl: false,
    // @fastify/static 10 передаёт в setHeaders FastifyReply, а тип в Nest 12
    // всё ещё описывает объект с setHeader(). Вызов res.setHeader() компилируется,
    // но роняет процесс на первом же запросе файла, поэтому reply.header().
    setHeaders(res, filePath) {
      (res as unknown as FastifyReply).header(
        'cache-control',
        filePath.startsWith(immutableDir) ? IMMUTABLE : REVALIDATE,
      );
    },
  });

  // SPA fallback. Маршруты файлов и Nest точнее "/*", поэтому сюда попадают
  // только GET/HEAD, которым ничего другого не подошло.
  app
    .getHttpAdapter()
    .getInstance()
    .get('/*', (request, reply) => {
      if (!isSpaRoute(request.url)) {
        // Обработчик Nest для ненайденных маршрутов: JSON 404.
        return reply.callNotFound();
      }
      // Через @fastify/static, так что setHeaders выше добавит no-cache.
      return reply.sendFile('index.html');
    });
}
