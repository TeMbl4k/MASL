import {
  addMoscowDays,
  APP_TIME_ZONE,
  asDate,
  formatMoscow,
  formatMoscowTime,
  HOUR_MS,
  type Instant,
  MINUTE_MS,
  moscowDayKey,
  moscowWallTimeToInstant,
} from '@masl/shared';

/**
 * Russian date labels. Everything is in Moscow time (shared time.ts), whatever the device
 * time zone is.
 */

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «Сегодня» / «Завтра» for the Moscow day of `instant`, otherwise null. */
export function relativeDayName(instant: Instant, now: Instant): 'Сегодня' | 'Завтра' | null {
  const day = moscowDayKey(instant);
  const today = moscowDayKey(now);
  if (day === today) return 'Сегодня';
  if (day === addMoscowDays(today, 1)) return 'Завтра';
  return null;
}

/** Day of a start: «Сегодня», «Завтра», «Пт, 17 окт.». */
export function formatLobbyDay(startsAt: Instant, now: Instant): string {
  return (
    relativeDayName(startsAt, now) ??
    capitalize(formatMoscow(startsAt, { weekday: 'short', day: 'numeric', month: 'short' }))
  );
}

/** Card time: «Сегодня, 19:30», «Завтра, 10:00», «Пт, 17 окт., 19:30». */
export function formatLobbyStart(startsAt: Instant, now: Instant): string {
  return `${formatLobbyDay(startsAt, now)}, ${formatMoscowTime(startsAt)}`;
}

/** Lobby page time: «Завтра, пт 17 октября · 19:30–21:30», «Вс, 18 октября · 20:00–22:00». */
export function formatLobbyWhen(startsAt: Instant, endsAt: Instant, now: Instant): string {
  const relative = relativeDayName(startsAt, now);
  const weekday = formatMoscow(startsAt, { weekday: 'short' });
  const date = formatMoscow(startsAt, { day: 'numeric', month: 'long' });
  const day = relative ? `${relative}, ${weekday} ${date}` : `${capitalize(weekday)}, ${date}`;
  return `${day} · ${formatMoscowTime(startsAt)}–${formatMoscowTime(endsAt)}`;
}

/** Time left before the start: «Через 2 ч 15 мин», «Через 45 мин»; null once it has started. */
export function formatCountdown(startsAt: Instant, now: Instant): string | null {
  const left = asDate(startsAt).getTime() - asDate(now).getTime();
  if (left <= 0) return null;
  const minutes = Math.ceil(left / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `Через ${rest} мин`;
  return rest === 0 ? `Через ${hours} ч` : `Через ${hours} ч ${rest} мин`;
}

/** When something happened: «только что», «5 мин назад», «3 ч назад», «вчера», «12 окт.». */
export function formatTimeAgo(at: Instant, now: Instant): string {
  const ago = asDate(now).getTime() - asDate(at).getTime();
  if (ago < MINUTE_MS) return 'только что';
  if (ago < HOUR_MS) return `${Math.floor(ago / MINUTE_MS)} мин назад`;
  const today = moscowDayKey(now);
  const day = moscowDayKey(at);
  if (day === today) return `${Math.floor(ago / HOUR_MS)} ч назад`;
  if (day === addMoscowDays(today, -1)) return 'вчера';
  return formatShortDate(at);
}

/** «12 окт.» */
export function formatShortDate(at: Instant): string {
  return formatMoscow(at, { day: 'numeric', month: 'short' });
}

/** Duration chip: «45 мин», «1 ч», «1,5 ч», «1 ч 15 мин». */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  if (rest === 30) return `${hours},5 ч`;
  return `${hours} ч ${rest} мин`;
}

export interface DayChip {
  /** Moscow day 'YYYY-MM-DD'. */
  day: string;
  /** «Сегодня», «Завтра» or «Пт». */
  name: string;
  /** Day of the month. */
  date: number;
  /** «октябрь», shown where a new month starts in a long strip. */
  month: string;
  /** «пятница, 17 октября». */
  ariaLabel: string;
}

/** `count` Moscow days starting today, for day strips. */
export function dayChips(now: Instant, count: number): DayChip[] {
  const today = moscowDayKey(now);
  return Array.from({ length: count }, (_, i) => {
    const day = addMoscowDays(today, i);
    // Noon avoids any edge of the day when formatting.
    const noon = moscowWallTimeToInstant(day, '12:00');
    return {
      day,
      name: relativeDayName(noon, now) ?? capitalize(formatMoscow(noon, { weekday: 'short' })),
      date: Number(day.slice(8, 10)),
      month: formatMoscow(noon, { month: 'long' }),
      ariaLabel: formatMoscow(noon, { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  });
}

/** The device clock is not on Moscow time: time pickers then add «время московское». */
export function deviceOutsideMoscowTime(): boolean {
  return Intl.DateTimeFormat().resolvedOptions().timeZone !== APP_TIME_ZONE;
}
