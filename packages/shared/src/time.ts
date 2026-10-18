import { APP_TIME_ZONE } from './constants.js';

/**
 * Moscow time helpers. Everything goes through Intl with APP_TIME_ZONE, so the result never
 * depends on the device or server time zone, and no offset is hard-coded.
 */

/** A moment in time as a Date, epoch milliseconds or an ISO string from the API. */
export type Instant = Date | number | string;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^(\d{2}):(\d{2})$/;

let wallClockFormat: Intl.DateTimeFormat | undefined;
const wallClock = () =>
  (wallClockFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }));

/** The instant as a Date; throws RangeError on an invalid value. */
export function asDate(instant: Instant): Date {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid instant: ${String(instant)}`);
  }
  return date;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Like Date.UTC, but years 0–99 stay as they are (Date.UTC maps them to 1900–1999). */
function utcMs(year: number, monthIndex: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function formatDayKey(year: number, month: number, day: number): string {
  if (year < 0 || year > 9999) {
    throw new RangeError(`Day out of range: year ${year}`);
  }
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** Moscow wall-clock fields of an instant. */
function moscowFields(date: Date) {
  const fields = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of wallClock().formatToParts(date)) {
    if (part.type in fields) {
      fields[part.type as keyof typeof fields] = Number(part.value);
    }
  }
  // Some engines print midnight as 24 even with h23.
  if (fields.hour === 24) fields.hour = 0;
  return fields;
}

/** Moscow UTC offset at an instant, in milliseconds (positive east of UTC). */
function moscowOffsetMs(epochMs: number): number {
  const wholeSeconds = Math.floor(epochMs / 1000) * 1000;
  const f = moscowFields(new Date(wholeSeconds));
  return utcMs(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - wholeSeconds;
}

function parseDayKey(day: string): { year: number; month: number; day: number } {
  const match = DAY_KEY.exec(day);
  if (match) {
    const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(utcMs(year, month - 1, date));
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date) {
      return { year, month, day: date };
    }
  }
  throw new RangeError(`Invalid day: ${day}`);
}

/**
 * The instant when Moscow clocks show `time` ('HH:MM') on `day` ('YYYY-MM-DD').
 * Throws RangeError on a malformed or non-existent day or time.
 */
export function moscowWallTimeToInstant(day: string, time: string): Date {
  const d = parseDayKey(day);
  const match = WALL_TIME.exec(time);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new RangeError(`Invalid time: ${time}`);
  }
  const wallAsUtc = utcMs(d.year, d.month - 1, d.day, hour, minute);
  const guess = wallAsUtc - moscowOffsetMs(wallAsUtc);
  // Re-check the offset at the result, in case the guess crossed an offset change.
  const offset = moscowOffsetMs(guess);
  return new Date(wallAsUtc - offset);
}

/** Moscow calendar day of an instant, as 'YYYY-MM-DD'. */
export function moscowDayKey(instant: Instant): string {
  const f = moscowFields(asDate(instant));
  return formatDayKey(f.year, f.month, f.day);
}

/** The Moscow day `n` days after `day` (negative `n` goes back). */
export function addMoscowDays(day: string, n: number): string {
  const d = parseDayKey(day);
  const shifted = new Date(utcMs(d.year, d.month - 1, d.day + n));
  return formatDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Start (inclusive) and end (exclusive) instants of a Moscow day. */
export function moscowDayRange(day: string): { start: Date; end: Date } {
  return {
    start: moscowWallTimeToInstant(day, '00:00'),
    end: moscowWallTimeToInstant(addMoscowDays(day, 1), '00:00'),
  };
}

const formatCache = new Map<string, Intl.DateTimeFormat>();

/** Formats an instant in Moscow time with ru-RU conventions; formatters are cached per option set. */
export function formatMoscow(instant: Instant, options: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(options);
  let format = formatCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: APP_TIME_ZONE });
    formatCache.set(key, format);
  }
  return format.format(asDate(instant));
}

/** Moscow 'HH:MM' of an instant. */
export function formatMoscowTime(instant: Instant): string {
  const f = moscowFields(asDate(instant));
  return `${pad2(f.hour)}:${pad2(f.minute)}`;
}

/**
 * When a limit lifts, for messages: «после 18:40 (по Москве)», «завтра после 09:15 (по Москве)»
 * on the next Moscow day, «19 октября после 09:15 (по Москве)» later. A retryAt with seconds is
 * rounded up to the next minute, so the named time is never before the limit lifts.
 */
export function formatRetryAfter(retryAt: Instant, now: Instant): string {
  const at = new Date(Math.ceil(asDate(retryAt).getTime() / MINUTE_MS) * MINUTE_MS);
  const day = moscowDayKey(at);
  const today = moscowDayKey(now);
  const prefix =
    day === today
      ? ''
      : day === addMoscowDays(today, 1)
        ? 'завтра '
        : `${formatMoscow(at, { day: 'numeric', month: 'long' })} `;
  return `${prefix}после ${formatMoscowTime(at)} (по Москве)`;
}

/** The instant with seconds and milliseconds dropped. */
export function truncateToMinute(instant: Instant): Date {
  return new Date(Math.floor(asDate(instant).getTime() / MINUTE_MS) * MINUTE_MS);
}
