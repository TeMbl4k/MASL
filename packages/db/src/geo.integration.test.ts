import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { INTEREST_SLUGS, KARMA } from '@masl/shared';
import { nearestStation, placeHint } from '@masl/shared/metro';
import { createDb, type DbHandle } from './client.js';
import { distanceMeters, withinMeters, type GeoPoint } from './geo.js';
import { interests, karmaEvents, lobbies, users } from './schema.js';
import { seedInterests } from './seed.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

const adminUrl = process.env.TEST_DATABASE_URL;

// Dinamo and Belorusskaya metro stations: about 2 km apart in a straight line.
const DINAMO: GeoPoint = { lng: 37.5585, lat: 55.7894 };
const BELORUSSKAYA: GeoPoint = { lng: 37.5818, lat: 55.7774 };
const ZELENOGRAD: GeoPoint = { lng: 37.1944, lat: 55.9825 };

/** Public place columns derived from the nearest station, as the API does at create time. */
function publicPlace(point: GeoPoint) {
  const { station, line } = nearestStation(point);
  return {
    metroStationId: station.id,
    publicLocation: { lng: station.lng, lat: station.lat },
    placeHint: placeHint(station, line),
  };
}

describe.skipIf(!adminUrl)('PostGIS and schema (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  let hostId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 2 });
    await seedInterests(handle.db);
    const [host] = await handle.db
      .insert(users)
      .values({ telegramId: 100_000_001, firstName: 'Хост', telegramAuthDate: new Date() })
      .returning();
    hostId = host!.id;
  });

  afterAll(async () => {
    await handle?.close();
    await testDb?.drop();
  });

  it('interest seed is idempotent and removes interests no longer in the list', async () => {
    await handle.db.insert(interests).values({ slug: 'chess', title: 'Шахматы', emoji: '♟️', sortOrder: 99 });
    await seedInterests(handle.db);
    const rows = await handle.db.select().from(interests).orderBy(asc(interests.sortOrder));
    expect(rows.map((r) => r.slug)).toEqual(INTEREST_SLUGS);
  });

  it('new user gets the starting karma', async () => {
    const [row] = await handle.db.select().from(users).where(eq(users.id, hostId));
    expect(row?.karma).toBe(KARMA.START);
  });

  it('stores and reads a lobby point, computes distance in meters', async () => {
    const startsAt = new Date(Date.now() + 3600_000);
    const [lobby] = await handle.db
      .insert(lobbies)
      .values({
        hostId,
        category: 'sport',
        title: 'Падел-теннис 2х2',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3600_000),
        location: DINAMO,
        address: 'Ленинградский проспект, 36',
        ...publicPlace(DINAMO),
        slots: 3,
      })
      .returning();

    expect(lobby?.location.lng).toBeCloseTo(DINAMO.lng, 6);
    expect(lobby?.location.lat).toBeCloseTo(DINAMO.lat, 6);
    expect(lobby?.placeHint).toBe('м. Динамо');

    const [row] = await handle.db
      .select({ meters: distanceMeters(lobbies.location, BELORUSSKAYA) })
      .from(lobbies)
      .where(eq(lobbies.id, lobby!.id));
    expect(row?.meters).toBeGreaterThan(1800);
    expect(row?.meters).toBeLessThan(2200);
  });

  it('filters lobbies by radius', async () => {
    const startsAt = new Date(Date.now() + 7200_000);
    await handle.db.insert(lobbies).values({
      hostId,
      category: 'boardgames',
      title: 'Настолки в Зеленограде',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600_000),
      location: ZELENOGRAD,
      address: 'Зеленоград',
      ...publicPlace(ZELENOGRAD),
      slots: 4,
    });

    const near = await handle.db
      .select({ title: lobbies.title })
      .from(lobbies)
      .where(withinMeters(lobbies.location, BELORUSSKAYA, 5000));
    expect(near.map((r) => r.title)).toEqual(['Падел-теннис 2х2']);
  });

  it('rejects a lobby that ends before it starts', async () => {
    const startsAt = new Date(Date.now() + 3600_000);
    await expect(
      handle.db.insert(lobbies).values({
        hostId,
        category: 'bars',
        title: 'Сломанное время',
        startsAt,
        endsAt: new Date(startsAt.getTime() - 60_000),
        location: DINAMO,
        address: 'адрес',
        ...publicPlace(DINAMO),
        slots: 2,
      }),
    ).rejects.toThrow();
  });

  it('does not award karma twice for the same lobby', async () => {
    const [lobby] = await handle.db.select({ id: lobbies.id }).from(lobbies).limit(1);
    const event = { userId: hostId, lobbyId: lobby!.id, reason: 'attended' as const, delta: KARMA.ATTENDED };
    await handle.db.insert(karmaEvents).values(event);
    await expect(handle.db.insert(karmaEvents).values(event)).rejects.toThrow();
  });
});
