import { join, sep } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
// Types only: adds reply.sendFile() from @fastify/static.
import type {} from '@fastify/static';

/** Common prefix for all API routes: the Mini App and the API share one origin. */
export const API_PREFIX = 'api';

const IMMUTABLE = 'public, max-age=31536000, immutable';
/** The browser may cache the file but revalidates it before use (ETag → 304). */
const REVALIDATE = 'no-cache';

/**
 * A path handled by the SvelteKit client router: not /api, not /_app
 * (build files), and no extension in the last segment. This way /missing.js
 * or a stale /_app/immutable/x.js chunk after a deploy gets a real 404
 * instead of index.html with status 200.
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
 * Serves the Mini App build (adapter-static) from the same Fastify instance as the API.
 * Call before app.init() / app.listen().
 */
export function serveSpa(app: NestFastifyApplication, root: string): void {
  const immutableDir = join(root, '_app', 'immutable') + sep;

  app.useStaticAssets({
    root,
    // One route per build file found at startup (plus "/" for index.html),
    // which leaves the "/*" pattern free for the fallback below.
    wildcard: false,
    // Cache-Control is set manually in setHeaders.
    cacheControl: false,
    // @fastify/static 10 passes a FastifyReply to setHeaders, but the Nest 12 type
    // still describes an object with setHeader(). res.setHeader() compiles but
    // crashes the process on the very first file request, hence reply.header().
    setHeaders(res, filePath) {
      (res as unknown as FastifyReply).header(
        'cache-control',
        filePath.startsWith(immutableDir) ? IMMUTABLE : REVALIDATE,
      );
    },
  });

  // SPA fallback. File and Nest routes are more specific than "/*", so only
  // GET/HEAD requests that matched nothing else end up here.
  app
    .getHttpAdapter()
    .getInstance()
    .get('/*', (request, reply) => {
      if (!isSpaRoute(request.url)) {
        // Nest's not-found handler: JSON 404.
        return reply.callNotFound();
      }
      // Goes through @fastify/static, so setHeaders above adds no-cache.
      return reply.sendFile('index.html');
    });
}
