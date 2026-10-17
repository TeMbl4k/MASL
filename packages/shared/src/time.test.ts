import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMoscowDays,
  asDate,
  formatMoscow,
  formatMoscowTime,
  formatRetryAfter,
  moscowDayKey,
  moscowDayRange,
  moscowWallTimeToInstant,
  truncateToMinute,
} from './time.js';

function checkMoscowConversions() {
  expect(moscowWallTimeToInstant('2026-10-17', '00:30').toISOString()).toBe('2026-10-16T21:30:00.000Z');
  expect(moscowWallTimeToInstant('2026-10-17', '19:30').toISOString()).toBe('2026-10-17T16:30:00.000Z');
  // 23:59 and 00:00 Moscow time fall on different Moscow days.
  expect(moscowDayKey('2026-10-16T20:59:00.000Z')).toBe('2026-10-16');
  expect(moscowDayKey('2026-10-16T21:00:00.000Z')).toBe('2026-10-17');
  expect(formatMoscowTime('2026-10-16T21:05:00.000Z')).toBe('00:05');
}

describe('moscowWallTimeToInstant and moscowDayKey', () => {
  it('convert Moscow wall time and days', () => {
    checkMoscowConversions();
  });

  it('use the historical offset instead of a hard-coded +03:00 (UTC+4 in 2011–2014)', () => {
    expect(moscowWallTimeToInstant('2014-01-15', '12:00').toISOString()).toBe('2014-01-15T08:00:00.000Z');
  });

  it('reject malformed and non-existent values', () => {
    expect(() => moscowWallTimeToInstant('2026-02-30', '10:00')).toThrow(RangeError);
    expect(() => moscowWallTimeToInstant('2026-10-17', '24:00')).toThrow(RangeError);
    expect(() => moscowWallTimeToInstant('2026-10-17', '9:30')).toThrow(RangeError);
    expect(() => moscowWallTimeToInstant('17.10.2026', '09:30')).toThrow(RangeError);
    expect(() => moscowDayKey('not a date')).toThrow(RangeError);
  });

  describe('when the process runs in another time zone', () => {
    const original = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/New_York';
    });
    afterAll(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    it('give the same results', () => {
      // The switch took effect: New York is UTC−4 in October 2026.
      expect(new Date('2026-10-17T12:00:00.000Z').getTimezoneOffset()).toBe(240);
      checkMoscowConversions();
      expect(moscowDayRange('2026-10-17').start.toISOString()).toBe('2026-10-16T21:00:00.000Z');
    });
  });
});

describe('Moscow days', () => {
  it('add days across months, leap years and backwards', () => {
    expect(addMoscowDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addMoscowDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addMoscowDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMoscowDays('2026-10-17', 30)).toBe('2026-11-16');
    expect(addMoscowDays('2026-10-17', 0)).toBe('2026-10-17');
  });

  it('give a day range from Moscow midnight to the next', () => {
    const { start, end } = moscowDayRange('2026-10-17');
    expect(start.toISOString()).toBe('2026-10-16T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-17T21:00:00.000Z');
  });

  it('keep years 0–99 as they are instead of mapping them to the 1900s', () => {
    expect(addMoscowDays('0099-12-31', 1)).toBe('0100-01-01');
    expect(addMoscowDays('0050-03-01', -1)).toBe('0050-02-28');
    const { start, end } = moscowDayRange('0050-01-01');
    expect(moscowDayKey(start)).toBe('0050-01-01');
    expect(moscowDayKey(end)).toBe('0050-01-02');
    expect(formatMoscowTime(moscowWallTimeToInstant('0050-06-15', '12:00'))).toBe('12:00');
  });

  it('refuse to leave the four-digit years', () => {
    expect(() => addMoscowDays('9999-12-31', 1)).toThrow(RangeError);
    expect(() => moscowDayRange('9999-12-31')).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('formats in Moscow time with Russian conventions', () => {
    expect(formatMoscow('2026-10-16T21:30:00.000Z', { hour: '2-digit', minute: '2-digit' })).toBe('00:30');
    expect(formatMoscow(new Date('2026-10-16T21:30:00.000Z'), { day: 'numeric', month: 'long' })).toBe(
      '17 октября',
    );
  });

  it('ignores a time zone passed in the options', () => {
    expect(formatMoscow('2026-10-16T21:30:00.000Z', { hour: '2-digit', timeZone: 'UTC' })).toBe(
      formatMoscow('2026-10-16T21:30:00.000Z', { hour: '2-digit' }),
    );
  });

  it('formats retryAt for limit messages', () => {
    const now = '2026-10-17T10:00:00.000Z'; // 13:00 in Moscow
    expect(formatRetryAfter('2026-10-17T15:40:00.000Z', now)).toBe('после 18:40 (по Москве)');
    expect(formatRetryAfter('2026-10-18T06:15:00.000Z', now)).toBe('завтра после 09:15 (по Москве)');
    expect(formatRetryAfter('2026-10-19T06:15:00.000Z', now)).toBe('19 октября после 09:15 (по Москве)');
    // 22:00 UTC is already the next Moscow day.
    expect(formatRetryAfter('2026-10-17T22:00:00.000Z', now)).toBe('завтра после 01:00 (по Москве)');
  });

  it('rounds retryAt with seconds up to the next minute, never naming a time before it', () => {
    const now = '2026-10-17T15:40:10.000Z';
    expect(formatRetryAfter('2026-10-17T15:40:30.000Z', now)).toBe('после 18:41 (по Москве)');
    expect(formatRetryAfter('2026-10-17T15:40:00.001Z', now)).toBe('после 18:41 (по Москве)');
    expect(formatRetryAfter('2026-10-17T15:40:00.000Z', now)).toBe('после 18:40 (по Москве)');
    // 23:59:30 in Moscow rounds into the next Moscow day.
    expect(formatRetryAfter('2026-10-17T20:59:30.000Z', now)).toBe('завтра после 00:00 (по Москве)');
  });
});

describe('instants', () => {
  it('truncate to the minute', () => {
    expect(truncateToMinute('2026-10-17T12:34:56.789Z').toISOString()).toBe('2026-10-17T12:34:00.000Z');
    expect(truncateToMinute(new Date('2026-10-17T12:34:00.000Z')).toISOString()).toBe(
      '2026-10-17T12:34:00.000Z',
    );
  });

  it('accept a Date, epoch milliseconds or an ISO string', () => {
    const iso = '2026-10-17T12:00:00.000Z';
    expect(asDate(iso).toISOString()).toBe(iso);
    expect(asDate(Date.parse(iso)).toISOString()).toBe(iso);
    const date = new Date(iso);
    expect(asDate(date)).toBe(date);
    expect(() => asDate('garbage')).toThrow(RangeError);
  });
});
