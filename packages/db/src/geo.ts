import { customType } from 'drizzle-orm/pg-core';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** Точка в WGS 84: долгота и широта в градусах. */
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

/** EWKT, который PostgreSQL сам приводит к geography(Point, 4326). */
export function toEwkt(point: GeoPoint): string {
  assertValidPoint(point);
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
}

/**
 * Разбирает hex (E)WKB точки, в котором PostGIS отдаёт geography/geometry.
 * Поддерживается только Point (2D), с SRID и без.
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
 * Колонка geography(Point, 4326). Расстояния по ней PostGIS считает в метрах.
 *
 * Внимание: drizzle-kit берёт имя пользовательского типа в кавычки
 * ("geography(Point, 4326)"), и PostgreSQL такой тип не находит. После
 * `drizzle-kit generate` уберите кавычки в сгенерированном SQL вручную;
 * тест миграций в geo.integration.test.ts это ловит.
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

/** SQL-выражение точки geography из координат (параметризовано). */
export function geographyFrom(point: GeoPoint): SQL {
  assertValidPoint(point);
  return sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
}

/** Расстояние в метрах между колонкой geography и точкой. */
export function distanceMeters(column: SQLWrapper, point: GeoPoint): SQL<number> {
  return sql<number>`ST_Distance(${column}, ${geographyFrom(point)})`.mapWith(Number);
}

/** Условие «колонка в радиусе N метров от точки». Использует GIST-индекс. */
export function withinMeters(column: SQLWrapper, point: GeoPoint, meters: number): SQL {
  return sql`ST_DWithin(${column}, ${geographyFrom(point)}, ${meters})`;
}
