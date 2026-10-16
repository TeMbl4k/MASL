import { describe, expect, it } from 'vitest';
import { parsePointWkb, toEwkt } from './geo.js';

describe('toEwkt', () => {
  it('writes longitude first and SRID 4326', () => {
    expect(toEwkt({ lng: 37.5585, lat: 55.7894 })).toBe('SRID=4326;POINT(37.5585 55.7894)');
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => toEwkt({ lng: 200, lat: 10 })).toThrow(RangeError);
    expect(() => toEwkt({ lng: 10, lat: -91 })).toThrow(RangeError);
    expect(() => toEwkt({ lng: Number.NaN, lat: 0 })).toThrow(RangeError);
  });
});

describe('parsePointWkb', () => {
  it('parses EWKB with SRID (as PostGIS returns geography)', () => {
    // SELECT 'SRID=4326;POINT(37.5585 55.7894)'::geography
    const hex = '0101000020E6100000736891ED7CC7424030BB270F0BE54B40';
    const point = parsePointWkb(hex);
    expect(point.lng).toBeCloseTo(37.5585, 6);
    expect(point.lat).toBeCloseTo(55.7894, 6);
  });

  it('parses big-endian WKB without SRID', () => {
    // POINT(1 2), big-endian, no SRID
    const hex = '00000000013FF00000000000004000000000000000';
    expect(parsePointWkb(hex)).toEqual({ lng: 1, lat: 2 });
  });

  it('rejects non-point geometries', () => {
    // LINESTRING EMPTY: type 2
    expect(() => parsePointWkb('010200000000000000')).toThrow();
  });
});
