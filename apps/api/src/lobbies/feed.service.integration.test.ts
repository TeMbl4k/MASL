import { HttpException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createDb, lobbies, seedInterests, userInterests, type DbHandle } from '@masl/db';
import { createTestDatabase, type TestDatabase } from '@masl/db/testing';
import {
  effectiveLobbyStatus,
  feedQuery,
  type FeedQuery,
  type FeedResponse,
  type LobbyCategory,
  type LobbyStatus,
} from '@masl/shared';
import { stationById } from '@masl/shared/metro';
import { addKarmaEvent, adminUrl, CANARY_POINT, insertLobby, insertUser } from '../../test/helpers.js';
import type { Clock } from '../clock/clock.module.js';
import type { Env } from '../config/env.js';
import { FeedService } from './feed.service.js';
import { LobbiesService } from './lobbies.service.js';
import { effectiveStatusSql } from './lobby-queries.js';

/** 12:00 in Moscow. */
const NOW = new Date('2026-10-17T09:00:00.000Z');
const HOUR_MIN = 60;
/** Exact points near two stations far apart. */
const NEAR_DINAMO = CANARY_POINT;
const NEAR_TEPLY_STAN = { lat: 55.6195, lng: 37.5085 };

describe.skipIf(!adminUrl)('FeedService (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  let feeds: FeedService;
  let now = NOW;
  const clock: Clock = { now: () => now };

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 4 });
    await seedInterests(handle.db);
    const lobbiesService = new LobbiesService(handle.db, clock, {} as Env);
    feeds = new FeedService(handle.db, clock, lobbiesService);
  });

  afterAll(async () => {
    await handle?.close();
    await testDb?.drop();
  });

  beforeEach(async () => {
    now = NOW;
    // Every case starts with an empty feed.
    await handle.db.delete(lobbies);
  });

  const viewerWith = async (interests: LobbyCategory[] = ['sport'], karma?: number) => {
    const user = await insertUser(handle.db, { onboardedAt: NOW, ...(karma === undefined ? {} : { karma }) });
    await setInterests(user.id, interests);
    return user;
  };

  const setInterests = async (userId: string, interests: LobbyCategory[]) => {
    await handle.db.delete(userInterests).where(eq(userInterests.userId, userId));
    if (interests.length) {
      await handle.db
        .insert(userInterests)
        .values(interests.map((interestSlug) => ({ userId, interestSlug })));
    }
  };

  const lobby = async (
    options: Omit<Parameters<typeof insertLobby>[1], 'hostId' | 'now'> & { hostId?: string },
  ) => {
    const hostId = options.hostId ?? (await insertUser(handle.db)).id;
    return (await insertLobby(handle.db, { ...options, hostId, now: NOW })).id;
  };

  const feed = (
    viewerId: string,
    query: Partial<Record<keyof FeedQuery, unknown>> = {},
  ): Promise<FeedResponse> => feeds.feed(viewerId, feedQuery.parse(query));

  const ids = async (viewerId: string, query: Partial<Record<keyof FeedQuery, unknown>> = {}) =>
    (await feed(viewerId, query)).items.map((i) => i.id);

  describe('ranking, with the other terms equal', () => {
    it('an interest match beats a non-match, and changing interests changes the order', async () => {
      const viewer = await viewerWith(['sport']);
      const sport = await lobby({ category: 'sport', startsInMin: 5 * HOUR_MIN });
      const cinema = await lobby({ category: 'cinema', startsInMin: 5 * HOUR_MIN });
      expect(await ids(viewer.id)).toEqual([sport, cinema]);

      await setInterests(viewer.id, ['cinema']);
      expect(await ids(viewer.id)).toEqual([cinema, sport]);
    });

    it('within 48 h beats 5 days, and 2 h beats 30 h', async () => {
      const viewer = await viewerWith();
      const fiveDays = await lobby({ startsInMin: 5 * 24 * HOUR_MIN });
      const thirtyHours = await lobby({ startsInMin: 30 * HOUR_MIN });
      const twoHours = await lobby({ startsInMin: 2 * HOUR_MIN });
      expect(await ids(viewer.id)).toEqual([twoHours, thirtyHours, fiveDays]);
    });

    it('a nearer station beats a farther one; without an origin the distance is null and plays no part', async () => {
      const viewer = await viewerWith();
      const far = await lobby({ exact: NEAR_TEPLY_STAN, startsInMin: 5 * HOUR_MIN });
      const near = await lobby({ exact: NEAR_DINAMO, startsInMin: 5 * HOUR_MIN });
      const dinamo = stationById('2-dinamo')!.station;
      const fromDinamo = await feed(viewer.id, { lat: String(dinamo.lat), lng: String(dinamo.lng) });
      expect(fromDinamo.items.map((i) => i.id)).toEqual([near, far]);
      expect(fromDinamo.items[0]!.distanceM).toBeLessThan(fromDinamo.items[1]!.distanceM!);

      const teplyStan = { lat: 55.6188, lng: 37.5059 };
      expect(await ids(viewer.id, { lat: String(teplyStan.lat), lng: String(teplyStan.lng) })).toEqual([
        far,
        near,
      ]);

      const anywhere = await feed(viewer.id);
      expect(anywhere.items.map((i) => i.distanceM)).toEqual([null, null]);
      // Equal scores: start time, then id decides.
      expect(anywhere.items.map((i) => i.id)).toEqual([far, near].sort());
    });

    it('every locked lobby comes after every unlocked one', async () => {
      const viewer = await viewerWith(['sport']);
      const lockedSoon = await lobby({ minKarma: 51, startsInMin: 2 * HOUR_MIN, category: 'sport' });
      const lockedLater = await lobby({ minKarma: 80, startsInMin: 3 * HOUR_MIN, category: 'sport' });
      const unlockedLate = await lobby({ minKarma: 50, startsInMin: 20 * 24 * HOUR_MIN, category: 'cinema' });
      const unlockedFar = await lobby({ exact: NEAR_TEPLY_STAN, startsInMin: 10 * 24 * HOUR_MIN });
      const items = (await feed(viewer.id, { lat: String(NEAR_DINAMO.lat), lng: String(NEAR_DINAMO.lng) }))
        .items;
      // Even a soon, matching, near lobby ranks below every unlocked one once it is locked.
      expect(
        items
          .slice(0, 2)
          .map((i) => i.id)
          .sort(),
      ).toEqual([unlockedFar, unlockedLate].sort());
      expect(items.slice(2).map((i) => i.id)).toEqual([lockedSoon, lockedLater]);
      expect(items.map((i) => i.viewer.applyBlock)).toEqual([null, null, 'karma', 'karma']);
    });
  });

  describe('paging', () => {
    const pageAll = async (viewerId: string, between?: (page: number) => Promise<void>, limit = 2) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const response: FeedResponse = await feed(viewerId, {
          limit: String(limit),
          ...(cursor ? { cursor } : {}),
        });
        expect(response.days === null).toBe(page > 0);
        seen.push(...response.items.map((i) => i.id));
        cursor = response.nextCursor;
        if (!cursor) return seen;
        await between?.(page);
      }
      throw new Error('feed did not end');
    };

    it('limit=2 over 7 lobbies: complete, no duplicates, the same order as one page', async () => {
      const viewer = await viewerWith(['sport']);
      const created: string[] = [];
      for (let i = 0; i < 7; i++) {
        created.push(
          await lobby({
            startsInMin: (2 + i * 7) * HOUR_MIN,
            category: i % 2 ? 'cinema' : 'sport',
            minKarma: i === 3 ? 90 : null,
          }),
        );
      }
      const all = await ids(viewer.id, { limit: '50' });
      expect([...all].sort()).toEqual([...created].sort());
      expect(await pageAll(viewer.id)).toEqual(all);
    });

    it('a lobby inserted between pages causes no duplicates; a cancellation skips nothing else', async () => {
      const viewer = await viewerWith();
      const created: string[] = [];
      for (let i = 0; i < 7; i++) created.push(await lobby({ startsInMin: (2 + i * 5) * HOUR_MIN }));
      const all = await ids(viewer.id);

      let inserted: string | undefined;
      const seen = await pageAll(viewer.id, async (page) => {
        if (page === 0) inserted = await lobby({ startsInMin: 90 });
        if (page === 1) {
          // Cancel a lobby on a later page.
          await handle.db
            .update(lobbies)
            .set({ status: 'cancelled', cancelledAt: NOW })
            .where(eq(lobbies.id, all[5]!));
        }
      });
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toEqual(all.filter((id) => id !== all[5]));
      expect(seen).not.toContain(inserted);
    });

    it('karma or interests changing between pages neither repeats nor skips a lobby', async () => {
      const viewer = await viewerWith(['culture']);
      const created = [
        await lobby({ category: 'culture', minKarma: 45, startsInMin: HOUR_MIN }),
        await lobby({ category: 'culture', minKarma: 60, startsInMin: 2 * HOUR_MIN }),
        await lobby({ category: 'cinema', startsInMin: 3 * HOUR_MIN }),
        await lobby({ category: 'culture', startsInMin: 10 * HOUR_MIN }),
        await lobby({ category: 'culture', startsInMin: 20 * HOUR_MIN }),
      ];
      const all = await ids(viewer.id, { limit: '50' });
      expect([...all].sort()).toEqual([...created].sort());

      const seen = await pageAll(
        viewer.id,
        async (page) => {
          // A late cancel locks the first lobby; a rise unlocks both; then the interests change.
          if (page === 0) await addKarmaEvent(handle.db, viewer.id, 'manual', { delta: -15 });
          if (page === 1) await addKarmaEvent(handle.db, viewer.id, 'manual', { delta: 30 });
          if (page === 2) await setInterests(viewer.id, ['cinema']);
        },
        1,
      );
      expect(seen).toEqual(all);
    });

    it('a cursor of another query, or an expired one, is invalid_cursor', async () => {
      const viewer = await viewerWith();
      for (let i = 0; i < 3; i++) await lobby({ startsInMin: (2 + i) * HOUR_MIN });
      const { nextCursor } = await feed(viewer.id, { limit: '2' });
      expect(nextCursor).not.toBeNull();

      const refused = (query: Record<string, unknown>) =>
        feed(viewer.id, { limit: '2', cursor: nextCursor, ...query }).then(
          () => null,
          (error: unknown) => (error as HttpException).getResponse(),
        );
      expect(await refused({ category: 'cinema' })).toMatchObject({ code: 'invalid_cursor' });
      expect(await refused({ lat: '55.75', lng: '37.61' })).toMatchObject({ code: 'invalid_cursor' });
      expect(await refused({ day: '2026-10-17' })).toMatchObject({ code: 'invalid_cursor' });
      expect(await refused({})).toBeNull();
      now = new Date(NOW.getTime() + 31 * 60_000);
      expect(await refused({})).toMatchObject({ code: 'invalid_cursor' });
    });

    it('a later page filters by the current time and keeps the frozen ranking', async () => {
      const viewer = await viewerWith();
      const soon = await lobby({ startsInMin: 20 });
      const rest: string[] = [];
      for (let i = 0; i < 3; i++) rest.push(await lobby({ startsInMin: (3 + i) * HOUR_MIN }));
      const first = await feed(viewer.id, { limit: '2' });
      expect(first.items[0]!.id).toBe(soon);
      now = new Date(NOW.getTime() + 25 * 60_000);
      const second = await feed(viewer.id, { limit: '2', cursor: first.nextCursor });
      expect(second.items.map((i) => i.id)).toEqual(rest.slice(1));
    });
  });

  it('the day filter and day counts follow Moscow days at 23:30 and 00:30', async () => {
    const viewer = await viewerWith();
    // 2026-10-18 23:30 MSK and 2026-10-19 00:30 MSK.
    const lateEvening = await lobby({
      startsInMin: (new Date('2026-10-18T20:30:00Z').getTime() - NOW.getTime()) / 60_000,
    });
    const afterMidnight = await lobby({
      startsInMin: (new Date('2026-10-18T21:30:00Z').getTime() - NOW.getTime()) / 60_000,
    });
    expect(await ids(viewer.id, { day: '2026-10-18' })).toEqual([lateEvening]);
    expect(await ids(viewer.id, { day: '2026-10-19' })).toEqual([afterMidnight]);
    expect(await ids(viewer.id, { day: '2026-10-17' })).toEqual([]);
    const { days } = await feed(viewer.id, { day: '2026-10-19' });
    expect(days).toEqual([
      { date: '2026-10-17', count: 0 },
      { date: '2026-10-18', count: 1 },
      { date: '2026-10-19', count: 1 },
      { date: '2026-10-20', count: 0 },
      { date: '2026-10-21', count: 0 },
      { date: '2026-10-22', count: 0 },
      { date: '2026-10-23', count: 0 },
    ]);
  });

  it('effectiveStatusSql matches effectiveLobbyStatus', async () => {
    const host = await insertUser(handle.db);
    const cases: { status: LobbyStatus; startsInMin: number; durationMin: number }[] = [
      { status: 'open', startsInMin: 60, durationMin: 60 },
      { status: 'open', startsInMin: 0, durationMin: 60 },
      { status: 'open', startsInMin: -30, durationMin: 60 },
      { status: 'open', startsInMin: -60, durationMin: 60 },
      { status: 'active', startsInMin: -120, durationMin: 60 },
      { status: 'finished', startsInMin: -120, durationMin: 60 },
      { status: 'cancelled', startsInMin: 60, durationMin: 60 },
      { status: 'cancelled', startsInMin: -120, durationMin: 60 },
    ];
    for (const c of cases) {
      const { id } = await insertLobby(handle.db, { hostId: host.id, now: NOW, ...c });
      const [row] = await handle.db
        .select({
          sql: effectiveStatusSql(NOW),
          status: lobbies.status,
          startsAt: lobbies.startsAt,
          endsAt: lobbies.endsAt,
        })
        .from(lobbies)
        .where(eq(lobbies.id, id));
      expect(row!.sql, JSON.stringify(c)).toBe(effectiveLobbyStatus(row!, NOW));
    }
  });
});
