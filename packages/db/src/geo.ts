import { customType } from 'drizzle-orm/pg-core';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** WGS 84 point: longitude and latitude in degrees. */
export interface GeoPoint {
  lng: number;
  lat: number;
}

export function assertValidPoint(point: GeoPoint): void {
  const { lng, lat } = point;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new RangeError(`Некорректные координаты: lng=${lng}, lat=${lat}`);
  }
}

/** EWKT that PostgreSQL implicitly casts to geography(Point, 4326). */
export function toEwkt(point: GeoPoint): string {
  assertValidPoint(point);
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
}

/**
 * Parses a point from hex (E)WKB, the format PostGIS returns geography/geometry in.
 * Only 2D Point is supported, with or without SRID.
 */
export function parsePointWkb(hex: string): GeoPoint {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length < 21) {
    throw new Error(`Слишком короткий WKB: ${hex}`);
  }
  const littleEndian = bytes.readUInt8(0) === 1;
  const readUInt32 = (offset: number) =>
    littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const readDouble = (offset: number) =>
    littleEndian ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);

  const rawType = readUInt32(1);
  const hasSrid = (rawType & 0x20000000) !== 0;
  const geometryType = rawType & 0x0fffffff;
  if (geometryType !== 1) {
    throw new Error(`Ожидалась точка (тип 1), получен тип ${geometryType}`);
  }
  let offset = 5;
  if (hasSrid) {
    offset += 4;
  }
  if (bytes.length < offset + 16) {
    throw new Error(`Слишком короткий WKB для точки: ${hex}`);
  }
  return { lng: readDouble(offset), lat: readDouble(offset + 8) };
}

/**
 * geography(Point, 4326) column. PostGIS computes distances on it in meters.
 *
 * Gotcha: drizzle-kit quotes the custom type name ("geography(Point, 4326)"),
 * and PostgreSQL can't find such a type. After `drizzle-kit generate`, remove
 * the quotes from the generated SQL by hand; the migration test in
 * geo.integration.test.ts catches this.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
  toDriver(value) {
    return toEwkt(value);
  },
  fromDriver(value) {
    return parsePointWkb(value);
  },
});

/** Parameterized SQL expression for a geography point from coordinates. */
export function geographyFrom(point: GeoPoint): SQL {
  assertValidPoint(point);
  return sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
}

/** Distance in meters between a geography column and a point. */
export function distanceMeters(column: SQLWrapper, point: GeoPoint): SQL<number> {
  return sql<number>`ST_Distance(${column}, ${geographyFrom(point)})`.mapWith(Number);
}

/** Condition "column is within N meters of the point". Uses the GIST index. */
export function withinMeters(column: SQLWrapper, point: GeoPoint, meters: number): SQL {
  return sql`ST_DWithin(${column}, ${geographyFrom(point)}, ${meters})`;
}
