import {
  addMoscowDays,
  asDate,
  formatMoscowTime,
  LOBBY_START_STEP_MINUTES,
  MINUTE_MS,
  moscowDayKey,
  moscowWallTimeToInstant,
  validateLobbyStart,
  type Instant,
} from '@masl/shared';
import { wallClock } from './validate.js';

/** A Moscow wall-clock start: the day strip and the two time selects. */
export interface WallTime {
  /** 'YYYY-MM-DD'. */
  day: string;
  hour: number;
  minute: number;
}

// Wizard defaults (spec §9.7): the next half hour at least an hour ahead; tomorrow evening late at night.
const DEFAULT_LEAD_MINUTES = 60;
const DEFAULT_ROUND_MINUTES = 30;
/** From this Moscow hour on the default start is tomorrow evening. */
const LATE_HOUR = 23;
const EVENING_HOUR = 19;
/** «Вечером в 19:00» is offered until 18:45. */
const EVENING_CHIP_LAST_MINUTE = 18 * 60 + 45;

/** Moscow wall time of an instant. */
export function wallTimeOf(instant: Instant): WallTime {
  const [hour, minute] = formatMoscowTime(instant).split(':').map(Number);
  return { day: moscowDayKey(instant), hour, minute };
}

export function instantOf(start: WallTime): Date {
  return moscowWallTimeToInstant(start.day, wallClock(start.hour, start.minute));
}

/** Rounds up to a whole number of minutes; Moscow offsets are whole hours, so epoch rounding is wall rounding. */
function ceilMinutes(ms: number, minutes: number): number {
  const step = minutes * MINUTE_MS;
  return Math.ceil(ms / step) * step;
}

const tomorrowEvening = (today: string): WallTime => ({
  day: addMoscowDays(today, 1),
  hour: EVENING_HOUR,
  minute: 0,
});

/** Today at the next half hour at least an hour ahead; from 23:00 (or past midnight) tomorrow at 19:00. */
export function defaultStart(now: Instant): WallTime {
  const current = wallTimeOf(now);
  if (current.hour >= LATE_HOUR) return tomorrowEvening(current.day);
  const start = wallTimeOf(
    ceilMinutes(asDate(now).getTime() + DEFAULT_LEAD_MINUTES * MINUTE_MS, DEFAULT_ROUND_MINUTES),
  );
  return start.day === current.day ? start : tomorrowEvening(current.day);
}

export interface QuickStart {
  label: string;
  start: WallTime;
}

/** Quick start chips that are valid at `now`, on the time picker's 5-minute grid. */
export function quickStarts(now: Instant): QuickStart[] {
  const t = asDate(now).getTime();
  const current = wallTimeOf(now);
  const inMinutes = (minutes: number) =>
    wallTimeOf(ceilMinutes(t + minutes * MINUTE_MS, LOBBY_START_STEP_MINUTES));
  const chips: QuickStart[] = [
    { label: 'Через 30 мин', start: inMinutes(30) },
    { label: 'Через час', start: inMinutes(60) },
  ];
  if (current.hour * 60 + current.minute < EVENING_CHIP_LAST_MINUTE) {
    chips.push({ label: 'Вечером в 19:00', start: { day: current.day, hour: EVENING_HOUR, minute: 0 } });
  }
  return chips.filter((chip) => validateLobbyStart(instantOf(chip.start), now) === null);
}

export function sameWallTime(a: WallTime, b: WallTime): boolean {
  return a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}
