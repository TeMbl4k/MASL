import { eq } from 'drizzle-orm';
import { createDb, karmaEvents, users, type DbHandle } from '@masl/db';
import { createTestDatabase, type TestDatabase } from '@masl/db/testing';
import { KARMA } from '@masl/shared';
import { adminUrl, insertLobby, insertUser, karmaEventsOf } from '../../test/helpers.js';
import { KarmaService } from './karma.service.js';

describe.skipIf(!adminUrl)('KarmaService.apply (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  const karma = new KarmaService();
  const now = new Date('2026-10-17T12:00:00.000Z');

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 4 });
  });

  afterAll(async () => {
    await handle?.close();
    await testDb?.drop();
  });

  const karmaOf = async (userId: string) => {
    const [row] = await handle.db
      .select({ karma: users.karma, updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, userId));
    return row!;
  };

  it('applies a lobby event once per (user, lobby, reason)', async () => {
    const host = await insertUser(handle.db);
    const user = await insertUser(handle.db);
    const lobby = await insertLobby(handle.db, { hostId: host.id });
    const change = {
      userId: user.id,
      lobbyId: lobby.id,
      reason: 'late_cancel' as const,
      delta: KARMA.LATE_CANCEL,
      now,
    };

    expect(await handle.db.transaction((tx) => karma.apply(tx, change))).toBe(true);
    expect(await handle.db.transaction((tx) => karma.apply(tx, change))).toBe(false);

    const events = await karmaEventsOf(handle.db, user.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ lobbyId: lobby.id, reason: 'late_cancel', delta: KARMA.LATE_CANCEL });
    expect(events[0]!.createdAt.toISOString()).toBe(now.toISOString());
    const after = await karmaOf(user.id);
    expect(after.karma).toBe(KARMA.START + KARMA.LATE_CANCEL);
    expect(after.updatedAt.toISOString()).toBe(now.toISOString());
  });

  it('concurrent applies of the same change record it once', async () => {
    const host = await insertUser(handle.db);
    const user = await insertUser(handle.db);
    const lobby = await insertLobby(handle.db, { hostId: host.id });
    const change = {
      userId: user.id,
      lobbyId: lobby.id,
      reason: 'late_cancel' as const,
      delta: KARMA.LATE_CANCEL,
      now,
    };
    const results = await Promise.all(
      [1, 2, 3].map(() => handle.db.transaction((tx) => karma.apply(tx, change))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await karmaEventsOf(handle.db, user.id)).toHaveLength(1);
    expect((await karmaOf(user.id)).karma).toBe(KARMA.START + KARMA.LATE_CANCEL);
  });

  it('keeps one event per reason: another reason on the same lobby applies', async () => {
    const host = await insertUser(handle.db);
    const user = await insertUser(handle.db);
    const lobby = await insertLobby(handle.db, { hostId: host.id });
    await handle.db.transaction((tx) =>
      karma.apply(tx, {
        userId: user.id,
        lobbyId: lobby.id,
        reason: 'late_cancel',
        delta: KARMA.LATE_CANCEL,
        now,
      }),
    );
    await handle.db.transaction((tx) =>
      karma.apply(tx, { userId: user.id, lobbyId: lobby.id, reason: 'attended', delta: KARMA.ATTENDED, now }),
    );
    expect(await karmaEventsOf(handle.db, user.id, lobby.id)).toHaveLength(2);
    expect((await karmaOf(user.id)).karma).toBe(KARMA.START + KARMA.LATE_CANCEL + KARMA.ATTENDED);
  });

  it('applies events without a lobby every time (the unique index is partial)', async () => {
    const user = await insertUser(handle.db);
    for (let i = 0; i < 2; i++) {
      await handle.db.transaction((tx) =>
        karma.apply(tx, { userId: user.id, lobbyId: null, reason: 'manual', delta: -1, now }),
      );
    }
    expect(await karmaEventsOf(handle.db, user.id)).toHaveLength(2);
    expect((await karmaOf(user.id)).karma).toBe(KARMA.START - 2);
  });

  it("rolls back with the caller's transaction", async () => {
    const user = await insertUser(handle.db);
    await expect(
      handle.db.transaction(async (tx) => {
        await karma.apply(tx, { userId: user.id, lobbyId: null, reason: 'manual', delta: -5, now });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await handle.db.select().from(karmaEvents).where(eq(karmaEvents.userId, user.id))).toEqual([]);
    expect((await karmaOf(user.id)).karma).toBe(KARMA.START);
  });
});
