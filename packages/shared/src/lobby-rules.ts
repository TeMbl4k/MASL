import {
  APPEAL_RETRY_DAYS,
  ATTENDANCE_CLOSE_HOURS_AFTER,
  CHECK_IN_OPENS_MINUTES_BEFORE,
  DISTANCE_ROUND_M,
  HOST_LATE_CANCEL_HOURS,
  LATE_CANCEL_WINDOW_HOURS,
  LOBBY_MIN_KARMA_PRESETS,
  LOBBY_MAX_DAYS_AHEAD,
  LOBBY_MIN_LEAD_MINUTES,
  MOSCOW_BOUNDS,
  PLACE_FAR_FROM_METRO_M,
  PLACE_MAX_FROM_METRO_M,
  VIEWER_COORD_DECIMALS,
} from './constants.js';
import type { ApiErrorCode, AttendanceState, LobbyStatus } from './enums.js';
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

/** From this moment a host cancel of a full lobby is a late cancel (KARMA.HOST_LATE_CANCEL). */
export function hostLateCancelFrom(startsAt: Instant): Date {
  return new Date(asDate(startsAt).getTime() - HOST_LATE_CANCEL_HOURS * HOUR_MS);
}

/**
 * A host cancel costs karma and blocks creation when it comes after hostLateCancelFrom and every
 * slot is taken; the stated reason doesn't matter. Cancels are only possible before the start.
 */
export function isHostLateCancel(
  lobby: { startsAt: Instant; slots: number; approvedCount: number },
  now: Instant,
): boolean {
  return (
    asDate(now).getTime() > hostLateCancelFrom(lobby.startsAt).getTime() && lobby.approvedCount >= lobby.slots
  );
}

/**
 * The karma threshold one preset step lower (quorum check): the largest preset below the current
 * value, or null (no threshold) below the lowest preset.
 */
export function lowerMinKarma(current: number): number | null {
  const lower = LOBBY_MIN_KARMA_PRESETS.filter((preset) => preset < current);
  return lower.length > 0 ? lower[lower.length - 1]! : null;
}

/** «Я на месте» works from CHECK_IN_OPENS_MINUTES_BEFORE before the start until the end. */
export function checkInOpensAt(startsAt: Instant): Date {
  return new Date(asDate(startsAt).getTime() - CHECK_IN_OPENS_MINUTES_BEFORE * MINUTE_MS);
}

export function checkInWindow(
  lobby: { startsAt: Instant; endsAt: Instant },
  now: Instant,
): 'not_open' | 'open' | 'closed' {
  const t = asDate(now).getTime();
  if (t < checkInOpensAt(lobby.startsAt).getTime()) return 'not_open';
  if (t >= asDate(lobby.endsAt).getTime()) return 'closed';
  return 'open';
}

/** The host can mark attendance from the end until this moment. */
export function attendanceDeadline(endsAt: Instant): Date {
  return new Date(asDate(endsAt).getTime() + ATTENDANCE_CLOSE_HOURS_AFTER * HOUR_MS);
}

export function attendanceState(
  lobby: {
    status: LobbyStatus;
    endsAt: Instant;
    attendanceSavedAt: Instant | null;
    attendanceClosedAt: Instant | null;
  },
  now: Instant,
): AttendanceState {
  if (lobby.attendanceSavedAt !== null) return 'saved';
  if (lobby.attendanceClosedAt !== null) return 'closed';
  if (lobby.status === 'cancelled' || asDate(now).getTime() < asDate(lobby.endsAt).getTime()) {
    return 'not_yet';
  }
  return asDate(now).getTime() < attendanceDeadline(lobby.endsAt).getTime() ? 'open' : 'closed';
}

/** The attendance save button, in the app and in the bot's poll. */
export function attendanceSaveLabel(present: number, absent: number): string {
  return `Сохранить: на встрече ${present}, не было ${absent}`;
}

/** Inclusive karma threshold; no threshold lets everyone in. */
export function meetsMinKarma(karma: number, minKarma: number | null): boolean {
  return minKarma === null || karma >= minKarma;
}

/** Why a host can't create lobbies after a late cancel of a full one (stage 3 §10). */
export const CREATION_BLOCKED_TITLE = 'Создание встреч заблокировано после отмены в последний час';
export const CREATION_BLOCKED_APPEAL = 'Обжаловать можно будет позже';

/** After a rejected appeal, the next one is allowed from this moment. */
export function appealRetryAt(decidedAt: Instant): Date {
  return new Date(asDate(decidedAt).getTime() + APPEAL_RETRY_DAYS * DAY_MS);
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
