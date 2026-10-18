import 'reflect-metadata';
import { and, eq, sql } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  applicationEvents,
  createDb,
  karmaEvents,
  lobbies,
  lobbyMembers,
  users,
  type Database,
  type DbHandle,
} from '@masl/db';
import { createTestDatabase, type TestDatabase } from '@masl/db/testing';
import {
  KARMA,
  LOBBY_DEFAULT_SLOTS,
  classifyMetroDistance,
  type AuthResponse,
  type CreateLobbyInput,
  type KarmaReason,
  type LobbyCategory,
  type LobbyStatus,
  type MeDto,
  type MembershipStatus,
} from '@masl/shared';
import { nearestStation, placeHint, type LatLng } from '@masl/shared/metro';
import { createApp } from '../src/app.factory.js';
import { loadEnv } from '../src/config/env.js';
import { KarmaService } from '../src/karma/karma.service.js';
import { FixedWindowStore } from '../src/rate-limit/fixed-window.store.js';
import { signInitData } from './init-data.helper.js';

export const adminUrl = process.env.TEST_DATABASE_URL;
export const BOT_TOKEN = '123456789:AAE-e2e-token_for-masl';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Exact address every fixture lobby gets; no response outside the exact place may contain it. */
export const CANARY_ADDRESS = 'CANARY-ул. Тестовая, 1';
/** Exact point of fixture lobbies: nearest station «Динамо», about 800 m away. */
export const CANARY_POINT: LatLng = { lat: 55.7835, lng: 37.552 };

// The canary must be far enough from its station that a leak can't pass for the station point.
{
  const { station, distanceM } = nearestStation(CANARY_POINT);
  const ok =
    station.name === 'Динамо' &&
    distanceM >= 500 &&
    distanceM <= 1200 &&
    Math.abs(station.lat - CANARY_POINT.lat) >= 0.002 &&
    Math.abs(station.lng - CANARY_POINT.lng) >= 0.002;
  if (!ok) {
    throw new Error(`CANARY_POINT no longer fits its constraints (station ${station.id}, ${distanceM} m)`);
  }
}

/** A response of app.inject(). */
export type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

export const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * A valid create body: the canary exact place, tomorrow at the next whole minute, a fresh
 * requestId. Overrides replace fields as they are (JSON-like values for invalid-input tests).
 */
export function lobbyInput(overrides: Partial<Record<keyof CreateLobbyInput, unknown>> = {}) {
  const startsAt = new Date(Math.ceil((Date.now() + 24 * HOUR_MS) / MINUTE_MS) * MINUTE_MS);
  return {
    category: 'sport',
    title: 'Падел 2×2',
    description: 'Ищем ещё двоих',
    startsAt: startsAt.toISOString(),
    durationMinutes: 120,
    location: { ...CANARY_POINT },
    address: CANARY_ADDRESS,
    slots: 3,
    minKarma: null,
    paymentFormat: 'split',
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

let telegramIdSeq = 0;
/** A Telegram id no other user of this test process has. */
export const freshTelegramId = () => 700_000_000 + process.pid * 1000 + ++telegramIdSeq;

export interface BootOptions {
  /** Extra environment, e.g. DADATA_API_KEY. */
  env?: Record<string, string>;
  /** Runs after the app is built and before routes are registered (init). */
  beforeInit?: (app: NestFastifyApplication) => void;
}

export interface TestApp {
  app: NestFastifyApplication;
  /** Direct access for fixtures and state changes. */
  db: Database;
  close: () => Promise<void>;
  /** Forgets every rate-limit window; call in beforeEach. */
  resetRateLimits: () => void;
  login: (telegramId?: number, firstName?: string) => Promise<AuthResponse>;
  onboard: (token: string, interests?: string[]) => Promise<MeDto>;
  loginOnboarded: (telegramId?: number, firstName?: string) => Promise<AuthResponse>;
  /** POST /api/lobbies with lobbyInput(overrides); the raw response. */
  createLobby: (token: string, overrides?: Parameters<typeof lobbyInput>[0]) => Promise<InjectResponse>;
}

/** A per-file test database and app, as in app.e2e-spec.ts. */
export async function bootApp(options: BootOptions = {}): Promise<TestApp> {
  const testDb: TestDatabase = await createTestDatabase(adminUrl!);
  let app: NestFastifyApplication | undefined;
  let handle: DbHandle | undefined;
  try {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: testDb.url,
      BOT_TOKEN,
      JWT_SECRET: 'e2e-secret-'.repeat(4),
      ...options.env,
    });
    app = await createApp(env, { logger: false });
    options.beforeInit?.(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    handle = createDb(testDb.url, { max: 4 });
  } catch (error) {
    await app?.close();
    await testDb.drop();
    throw error;
  }
  const ready = app;

  const login = async (telegramId = freshTelegramId(), firstName = 'Тест') => {
    const response = await ready.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: { initData: signInitData(BOT_TOKEN, { id: telegramId, first_name: firstName }) },
    });
    if (response.statusCode !== 200) {
      throw new Error(`login failed: ${response.statusCode} ${response.body}`);
    }
    return response.json<AuthResponse>();
  };

  const onboard = async (token: string, interests: string[] = ['sport', 'boardgames', 'bars']) => {
    const response = await ready.inject({
      method: 'PUT',
      url: '/api/me/onboarding',
      headers: authHeader(token),
      payload: { gender: 'female', age: 27, interests },
    });
    if (response.statusCode !== 200) {
      throw new Error(`onboarding failed: ${response.statusCode} ${response.body}`);
    }
    return response.json<MeDto>();
  };

  return {
    app: ready,
    db: handle.db,
    close: async () => {
      await ready.close();
      await handle.close();
      await testDb.drop();
    },
    resetRateLimits: () => ready.get(FixedWindowStore).clear(),
    login,
    onboard,
    loginOnboarded: async (telegramId, firstName) => {
      const auth = await login(telegramId, firstName);
      return { ...auth, user: await onboard(auth.token) };
    },
    createLobby: (token, overrides) =>
      ready.inject({
        method: 'POST',
        url: '/api/lobbies',
        headers: authHeader(token),
        payload: lobbyInput(overrides),
      }),
  };
}

/** A user straight in the database, for service-level tests. */
export async function insertUser(db: Database, patch: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ telegramId: freshTelegramId(), firstName: 'Тест', telegramAuthDate: new Date(), ...patch })
    .returning();
  return user!;
}

export interface InsertLobbyOptions {
  hostId: string;
  exact?: LatLng;
  startsInMin?: number;
  durationMin?: number;
  minKarma?: number | null;
  slots?: number;
  category?: LobbyCategory;
  status?: LobbyStatus;
  title?: string;
  /** Reference time for startsInMin and the timestamps; defaults to the real clock. */
  now?: Date;
}

/**
 * Inserts a lobby directly (bulk fixtures; bypasses the API limits), deriving the public place
 * from the nearest station the way the API does.
 */
export async function insertLobby(db: Database, options: InsertLobbyOptions) {
  const now = options.now ?? new Date();
  const exact = options.exact ?? CANARY_POINT;
  const { station, line, distanceM } = nearestStation(exact);
  const startsAt = new Date(now.getTime() + (options.startsInMin ?? 24 * 60) * MINUTE_MS);
  const status = options.status ?? 'open';
  const [lobby] = await db
    .insert(lobbies)
    .values({
      hostId: options.hostId,
      category: options.category ?? 'sport',
      title: options.title ?? 'Тестовая встреча',
      startsAt,
      endsAt: new Date(startsAt.getTime() + (options.durationMin ?? 120) * MINUTE_MS),
      location: exact,
      address: CANARY_ADDRESS,
      placeHint: placeHint(station, line),
      metroStationId: station.id,
      publicLocation: { lat: station.lat, lng: station.lng },
      farFromMetro: classifyMetroDistance(distanceM) === 'far',
      slots: options.slots ?? LOBBY_DEFAULT_SLOTS,
      minKarma: options.minKarma ?? null,
      status,
      cancelledAt: status === 'cancelled' ? now : null,
      cancelReason: status === 'cancelled' ? 'other' : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: lobbies.id, startsAt: lobbies.startsAt, endsAt: lobbies.endsAt });
  return lobby!;
}

const DECIDED_STATUSES: readonly MembershipStatus[] = ['approved', 'rejected', 'attended', 'no_show'];

/**
 * Puts a user into a lobby with the given status, consistent with the CHECKs. `cancelled`
 * with `decided` is "left an approved place"; without it, a withdrawn application.
 */
export async function setMembership(
  db: Database,
  lobbyId: string,
  userId: string,
  status: MembershipStatus,
  options: { decided?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const decided = DECIDED_STATUSES.includes(status) || (status === 'cancelled' && options.decided === true);
  const values = {
    status,
    appliedAt: now,
    decidedAt: decided ? now : null,
    cancelledAt: status === 'cancelled' ? now : null,
    updatedAt: now,
  };
  const [row] = await db
    .insert(lobbyMembers)
    .values({ lobbyId, userId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: [lobbyMembers.lobbyId, lobbyMembers.userId], set: values })
    .returning({ id: lobbyMembers.id });
  return row!;
}

/** Moves a lobby in time relative to now (to make it started or finished without waiting). */
export async function shiftLobby(
  db: Database,
  lobbyId: string,
  { startsInMin, durationMin = 120 }: { startsInMin: number; durationMin?: number },
) {
  const startsAt = new Date(Date.now() + startsInMin * MINUTE_MS);
  await db
    .update(lobbies)
    .set({ startsAt, endsAt: new Date(startsAt.getTime() + durationMin * MINUTE_MS) })
    .where(eq(lobbies.id, lobbyId));
}

/**
 * Moves by `hours` the creation time of a lobby (`id` is the lobby), or of every apply event
 * of a user (`id` is the user).
 */
export async function shiftCreatedAt(
  db: Database,
  table: 'lobbies' | 'application_events',
  id: string,
  hours: number,
) {
  const ms = hours * HOUR_MS;
  if (table === 'lobbies') {
    await db
      .update(lobbies)
      .set({ createdAt: sql`${lobbies.createdAt} + ${ms} * interval '1 millisecond'` })
      .where(eq(lobbies.id, id));
  } else {
    await db
      .update(applicationEvents)
      .set({ createdAt: sql`${applicationEvents.createdAt} + ${ms} * interval '1 millisecond'` })
      .where(eq(applicationEvents.userId, id));
  }
}

/** Moderation and onboarding flags only; karma changes go through addKarmaEvent. */
export async function setUser(
  db: Database,
  userId: string,
  patch: Partial<Pick<typeof users.$inferInsert, 'isShadowBanned' | 'lobbyCreationBlocked' | 'onboardedAt'>>,
) {
  await db.update(users).set(patch).where(eq(users.id, userId));
}

/** Reasons with a product delta; the others need an explicit one. */
const DEFAULT_DELTA: Partial<Record<KarmaReason, number>> = {
  attended: KARMA.ATTENDED,
  late_cancel: KARMA.LATE_CANCEL,
  no_show: KARMA.NO_SHOW,
};

/** A karma event through KarmaService, so users.karma = KARMA.START + Σ delta still holds. */
export async function addKarmaEvent(
  db: Database,
  userId: string,
  reason: KarmaReason,
  options: { lobbyId?: string; delta?: number; at?: Date } = {},
) {
  const delta = options.delta ?? DEFAULT_DELTA[reason];
  if (delta === undefined) {
    throw new Error(`addKarmaEvent: pass a delta for ${reason}`);
  }
  await db.transaction((tx) =>
    new KarmaService(db).apply(tx, {
      userId,
      lobbyId: options.lobbyId ?? null,
      reason,
      delta,
      now: options.at ?? new Date(),
    }),
  );
}

/** Karma events of a user, oldest first. */
export function karmaEventsOf(db: Database, userId: string, lobbyId?: string) {
  return db
    .select()
    .from(karmaEvents)
    .where(and(eq(karmaEvents.userId, userId), lobbyId ? eq(karmaEvents.lobbyId, lobbyId) : undefined))
    .orderBy(karmaEvents.id);
}

/**
 * Fails if the body carries the canary exact place: the address text anywhere, a {lat, lng}
 * pair at the canary point, or a number equal to the canary lat or lng.
 */
export function assertNoExactPlace(body: unknown, where = 'response'): void {
  const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (value.includes('CANARY')) throw new Error(`${where}: exact address at ${path}`);
    } else if (typeof value === 'number') {
      if (near(value, CANARY_POINT.lat, 1e-6) || near(value, CANARY_POINT.lng, 1e-6)) {
        throw new Error(`${where}: exact coordinate at ${path}`);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
    } else if (value !== null && typeof value === 'object') {
      const { lat, lng } = value as { lat?: unknown; lng?: unknown };
      if (
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        near(lat, CANARY_POINT.lat, 1e-4) &&
        near(lng, CANARY_POINT.lng, 1e-4)
      ) {
        throw new Error(`${where}: exact point at ${path}`);
      }
      for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
    }
  };
  visit(body, '$');
}
