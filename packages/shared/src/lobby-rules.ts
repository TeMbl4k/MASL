import {
  DISTANCE_ROUND_M,
  LATE_CANCEL_WINDOW_HOURS,
  LOBBY_MAX_DAYS_AHEAD,
  LOBBY_MIN_LEAD_MINUTES,
  MOSCOW_BOUNDS,
  PLACE_FAR_FROM_METRO_M,
  PLACE_MAX_FROM_METRO_M,
  VIEWER_COORD_DECIMALS,
} from './constants.js';
import type { ApiErrorCode, LobbyStatus } from './enums.js';
import { asDate, DAY_MS, HOUR_MS, type Instant, MINUTE_MS } from './time.js';

/**
 * Pure lobby rules shared by the API (authoritative, with its own clock) and the web
 * (previews and hints before a request).
 */

/**
 * Status that follows from time: a stored `cancelled` wins; otherwise finished from `endsAt`,
 * active from `startsAt`, open before. The stored open/active/finished is only a cache.
 */
export function effectiveLobbyStatus(
  lobby: { status: LobbyStatus; startsAt: Instant; endsAt: Instant },
  now: Instant,
): LobbyStatus {
  if (lobby.status === 'cancelled') return 'cancelled';
  const t = asDate(now).getTime();
  if (t >= asDate(lobby.endsAt).getTime()) return 'finished';
  if (t >= asDate(lobby.startsAt).getTime()) return 'active';
  return 'open';
}

export type LobbyStartIssue = Extract<ApiErrorCode, 'starts_too_soon' | 'starts_too_far'>;

/** Start must be within [now + LOBBY_MIN_LEAD_MINUTES, now + LOBBY_MAX_DAYS_AHEAD days], inclusive. */
export function validateLobbyStart(startsAt: Instant, now: Instant): LobbyStartIssue | null {
  const lead = asDate(startsAt).getTime() - asDate(now).getTime();
  if (lead < LOBBY_MIN_LEAD_MINUTES * MINUTE_MS) return 'starts_too_soon';
  if (lead > LOBBY_MAX_DAYS_AHEAD * DAY_MS) return 'starts_too_far';
  return null;
}

export const START_ISSUE_MESSAGES: Readonly<Record<LobbyStartIssue, string>> = {
  starts_too_soon: `Начало — не раньше чем через ${LOBBY_MIN_LEAD_MINUTES} минут`,
  starts_too_far: `Не дальше чем на ${LOBBY_MAX_DAYS_AHEAD} дней вперёд`,
};

/** An approved participant cancelling now loses karma: the start is less than the window away. */
export function isLateCancel(startsAt: Instant, now: Instant): boolean {
  const left = asDate(startsAt).getTime() - asDate(now).getTime();
  return left > 0 && left < LATE_CANCEL_WINDOW_HOURS * HOUR_MS;
}

/** Inclusive karma threshold; no threshold lets everyone in. */
export function meetsMinKarma(karma: number, minKarma: number | null): boolean {
  return minKarma === null || karma >= minKarma;
}

export const OUTSIDE_MOSCOW_MESSAGE = 'Пока работаем только в Москве';
export const PLACE_TOO_FAR_MESSAGE = `Пока поддерживаем места не дальше ${PLACE_MAX_FROM_METRO_M / 1000} км от метро или МЦК`;

export function isInMoscowBounds(point: { lat: number; lng: number }): boolean {
  return (
    point.lat >= MOSCOW_BOUNDS.south &&
    point.lat <= MOSCOW_BOUNDS.north &&
    point.lng >= MOSCOW_BOUNDS.west &&
    point.lng <= MOSCOW_BOUNDS.east
  );
}

/**
 * How the exact point relates to its nearest station: `near` shows the station as is,
 * `far` adds «далеко от метро», `too_far` rejects the lobby (PLACE_TOO_FAR_MESSAGE).
 */
export function classifyMetroDistance(distanceM: number): 'near' | 'far' | 'too_far' {
  if (distanceM > PLACE_MAX_FROM_METRO_M) return 'too_far';
  if (distanceM > PLACE_FAR_FROM_METRO_M) return 'far';
  return 'near';
}

const COORD_FACTOR = 10 ** VIEWER_COORD_DECIMALS;

/** Viewer coordinate rounded to VIEWER_COORD_DECIMALS (about 100 m), on the client and on the server. */
export function roundViewerCoord(value: number): number {
  return Math.round(value * COORD_FACTOR) / COORD_FACTOR;
}

/** Distance shown to the viewer, rounded to DISTANCE_ROUND_M. */
export function roundDistance(meters: number): number {
  return Math.round(meters / DISTANCE_ROUND_M) * DISTANCE_ROUND_M;
}
