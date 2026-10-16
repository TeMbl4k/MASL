import { describe, expect, it } from 'vitest';
import { parsePointWkb, toEwkt } from './geo.js';

describe('toEwkt', () => {
  it('пишет долготу первой и SRID 4326', () => {
    expect(toEwkt({ lng: 37.5585, lat: 55.7894 })).toBe('SRID=4326;POINT(37.5585 55.7894)');
  });

  it('отклоняет координаты вне диапазона', () => {
    expect(() => toEwkt({ lng: 200, lat: 10 })).toThrow(RangeError);
    expect(() => toEwkt({ lng: 10, lat: -91 })).toThrow(RangeError);
    expect(() => toEwkt({ lng: Number.NaN, lat: 0 })).toThrow(RangeError);
  });
});

describe('parsePointWkb', () => {
  it('разбирает EWKB с SRID (как отдаёт PostGIS для geography)', () => {
    // SELECT 'SRID=4326;POINT(37.5585 55.7894)'::geography
    const hex = '0101000020E6100000736891ED7CC7424030BB270F0BE54B40';
    const point = parsePointWkb(hex);
    expect(point.lng).toBeCloseTo(37.5585, 6);
    expect(point.lat).toBeCloseTo(55.7894, 6);
  });

  it('разбирает WKB без SRID в big-endian', () => {
    // POINT(1 2) в big-endian без SRID
    const hex = '00000000013FF00000000000004000000000000000';
    expect(parsePointWkb(hex)).toEqual({ lng: 1, lat: 2 });
  });

  it('отклоняет не-точки', () => {
    // LINESTRING EMPTY: тип 2
    expect(() => parsePointWkb('010200000000000000')).toThrow();
  });
});
