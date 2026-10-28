import { RequestMethod, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import type { RouteOptions } from 'fastify';
import { AchievementsModule } from '../src/achievements/achievements.module.js';
import { AdminModule } from '../src/admin/admin.module.js';
import { BroadcastsModule } from '../src/broadcasts/broadcasts.module.js';
import { RESPONSE_SCHEMA } from '../src/contracts/response-schema.decorator.js';
import { InvitesModule } from '../src/invites/invites.module.js';
import { KarmaModule } from '../src/karma/karma.module.js';
import { LobbiesModule } from '../src/lobbies/lobbies.module.js';
import { ModerationModule } from '../src/moderation/moderation.module.js';
import { AdminGuard, ModeratorGuard } from '../src/moderation/moderator.guard.js';
import { PeopleModule } from '../src/people/people.module.js';
import { PlacesModule } from '../src/places/places.module.js';
import { QrModule } from '../src/qr/qr.module.js';
import { RATE_LIMIT_BUCKETS } from '../src/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../src/rate-limit/rate-limit.guard.js';
import { AuthGuard } from '../src/session/auth.guard.js';
import { SupportModule } from '../src/support/support.module.js';
import { UsersModule } from '../src/users/users.module.js';
import { adminUrl, authHeader, bootApp, type TestApp } from './helpers.js';

/** The only routes open without a session (rule 11; GET /api/interests: decisions.md, Q12). */
const PUBLIC_ROUTES = ['GET /api/health', 'POST /api/auth/telegram', 'GET /api/interests'];

/** Modules whose handlers must declare @ResponseSchema (stage 2 contract). */
const SCHEMA_MODULES: readonly Type[] = [
  LobbiesModule,
  PlacesModule,
  KarmaModule,
  UsersModule,
  ModerationModule,
  PeopleModule,
  InvitesModule,
  SupportModule,
  AdminModule,
  AchievementsModule,
  QrModule,
  BroadcastsModule,
];

interface Handler {
  route: string;
  module: Type;
  controller: Type;
  method: (...args: unknown[]) => unknown;
  guards: unknown[];
}

const joinPath = (...parts: string[]) =>
  `/${parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/')}`;

const firstPath = (value: unknown) => (Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''));

/** Every controller handler of the app, with its full route and the guards that apply to it. */
function collectHandlers(t: TestApp): Handler[] {
  const handlers: Handler[] = [];
  for (const moduleRef of t.app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as Type;
      const base = firstPath(Reflect.getMetadata(PATH_METADATA, controller));
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const method = proto[name];
        if (name === 'constructor' || typeof method !== 'function') continue;
        const verb: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, method);
        if (verb === undefined) continue;
        const path = firstPath(Reflect.getMetadata(PATH_METADATA, method));
        handlers.push({
          route: `${RequestMethod[verb]} ${joinPath('api', base, path)}`,
          module: moduleRef.metatype as Type,
          controller,
          method: method as Handler['method'],
          guards: [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, method) as unknown[]) ?? [])],
        });
      }
    }
  }
  return handlers;
}

/** A concrete URL for a route pattern: every :param becomes a random UUID. */
const sampleUrl = (pattern: string) => pattern.replace(/:[^/]+/g, () => crypto.randomUUID());

describe.skipIf(!adminUrl)('every route is guarded (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  /** Routes as Fastify registered them, HEAD duplicates of GET left out. */
  const registered: string[] = [];

  beforeAll(async () => {
    t = await bootApp({
      beforeInit: (app) => {
        app
          .getHttpAdapter()
          .getInstance()
          .addHook('onRoute', (route: RouteOptions) => {
            for (const method of [route.method].flat()) {
              if (method !== 'HEAD') registered.push(`${method} ${route.url}`);
            }
          });
      },
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('T-AUTH-1: every registered route except the public ones has AuthGuard and answers 401 without a token', async () => {
    const handlers = collectHandlers(t);
    const byRoute = new Map(handlers.map((h) => [h.route, h]));

    expect(registered.length).toBeGreaterThan(PUBLIC_ROUTES.length);
    // Nothing is registered outside the controllers this test can inspect.
    expect([...registered].sort()).toEqual(handlers.map((h) => h.route).sort());
    // The allowlist names real routes only, so it can't silently go stale.
    for (const route of PUBLIC_ROUTES) {
      expect(byRoute.has(route), route).toBe(true);
    }

    const guarded = registered.filter((route) => !PUBLIC_ROUTES.includes(route));
    for (const route of guarded) {
      expect(byRoute.get(route)!.guards, route).toContain(AuthGuard);
      const [method, pattern] = route.split(' ') as [string, string];
      const response = await t.app.inject({
        method: method as 'GET',
        url: sampleUrl(pattern),
        payload: method === 'GET' || method === 'DELETE' ? undefined : {},
      });
      expect(response.statusCode, route).toBe(401);
    }
  });

  it('rate-limited handlers run RateLimitGuard after AuthGuard', () => {
    for (const h of collectHandlers(t)) {
      const guards = h.guards;
      const limited = Reflect.getMetadata(RATE_LIMIT_BUCKETS, h.method) !== undefined;
      if (limited || guards.includes(RateLimitGuard)) {
        expect(guards.indexOf(AuthGuard), h.route).toBeGreaterThanOrEqual(0);
        expect(guards.indexOf(RateLimitGuard), h.route).toBeGreaterThan(guards.indexOf(AuthGuard));
      }
    }
  });

  it('every /api/admin route runs ModeratorGuard or AdminGuard after AuthGuard and refuses a plain user', async () => {
    const user = await t.loginOnboarded();
    const admin = collectHandlers(t).filter((h) => h.route.split(' ')[1]!.startsWith('/api/admin/'));
    expect(admin.length).toBeGreaterThan(0);
    for (const h of admin) {
      expect(h.guards.indexOf(AuthGuard), h.route).toBeGreaterThanOrEqual(0);
      const role = Math.max(h.guards.indexOf(ModeratorGuard), h.guards.indexOf(AdminGuard));
      expect(role, h.route).toBeGreaterThan(h.guards.indexOf(AuthGuard));
      const [method, pattern] = h.route.split(' ') as [string, string];
      const response = await t.app.inject({
        method: method as 'GET',
        url: sampleUrl(pattern),
        headers: authHeader(user.token),
        payload: method === 'GET' ? undefined : {},
      });
      expect(response.statusCode, h.route).toBe(403);
      expect(response.json(), h.route).toMatchObject({ code: 'forbidden_moderation' });
    }
  });

  it('T-AUTH-2: every handler of the API modules declares @ResponseSchema', () => {
    const handlers = collectHandlers(t).filter((h) => SCHEMA_MODULES.includes(h.module));
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) {
      expect(Reflect.getMetadata(RESPONSE_SCHEMA, h.method), h.route).toBeDefined();
    }
  });
});
