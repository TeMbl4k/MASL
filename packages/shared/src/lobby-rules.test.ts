import { describe, expect, it } from 'vitest';
import {
  appealRetryAt,
  attendanceDeadline,
  attendanceState,
  checkInWindow,
  classifyMetroDistance,
  isHostLateCancel,
  lowerMinKarma,
  effectiveLobbyStatus,
  isInMoscowBounds,
  isLateCancel,
  meetsMinKarma,
  PLACE_TOO_FAR_MESSAGE,
  roundDistance,
  roundViewerCoord,
  START_ISSUE_MESSAGES,
  validateLobbyStart,
} from './lobby-rules.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = new Date('2026-10-17T12:00:00.000Z');
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

describe('validateLobbyStart', () => {
  it('requires at least 15 minutes of lead time', () => {
    expect(validateLobbyStart(at(14 * MINUTE + 59_000), now)).toBe('starts_too_soon');
    expect(validateLobbyStart(at(15 * MINUTE), now)).toBeNull();
    expect(validateLobbyStart(at(-HOUR), now)).toBe('starts_too_soon');
  });

  it('allows up to 30 days ahead', () => {
    expect(validateLobbyStart(at(30 * DAY), now)).toBeNull();
    expect(validateLobbyStart(at(30 * DAY + MINUTE), now)).toBe('starts_too_far');
  });

  it('accepts ISO strings', () => {
    expect(validateLobbyStart('2026-10-17T15:15:00+03:00', now)).toBeNull();
    expect(validateLobbyStart('2026-10-17T15:14:00+03:00', now)).toBe('starts_too_soon');
  });

  it('has a Russian message per issue', () => {
    expect(START_ISSUE_MESSAGES).toEqual({
      starts_too_soon: 'Начало — не раньше чем через 15 минут',
      starts_too_far: 'Не дальше чем на 30 дней вперёд',
    });
  });
});

describe('effectiveLobbyStatus', () => {
  const lobby = { status: 'open' as const, startsAt: at(HOUR), endsAt: at(3 * HOUR) };

  it('follows time: open before the start, active from the start, finished from the end', () => {
    expect(effectiveLobbyStatus(lobby, now)).toBe('open');
    expect(effectiveLobbyStatus(lobby, at(HOUR - 1))).toBe('open');
    expect(effectiveLobbyStatus(lobby, at(HOUR))).toBe('active');
    expect(effectiveLobbyStatus(lobby, at(3 * HOUR - 1))).toBe('active');
    expect(effectiveLobbyStatus(lobby, at(3 * HOUR))).toBe('finished');
    expect(effectiveLobbyStatus(lobby, at(10 * DAY))).toBe('finished');
  });

  it('treats a stored open/active/finished as a cache that time overrides', () => {
    expect(effectiveLobbyStatus({ ...lobby, status: 'active' }, now)).toBe('open');
    expect(effectiveLobbyStatus({ ...lobby, status: 'open' }, at(4 * HOUR))).toBe('finished');
  });

  it('keeps a stored cancelled at any time', () => {
    for (const t of [now, at(HOUR), at(3 * HOUR), at(10 * DAY)]) {
      expect(effectiveLobbyStatus({ ...lobby, status: 'cancelled' }, t)).toBe('cancelled');
    }
  });

  it('accepts ISO strings from the API', () => {
    expect(
      effectiveLobbyStatus(
        { status: 'open', startsAt: '2026-10-17T13:00:00.000Z', endsAt: '2026-10-17T15:00:00.000Z' },
        '2026-10-17T13:00:00.000Z',
      ),
    ).toBe('active');
  });
});

describe('isLateCancel', () => {
  it('is late within the 2 hours before the start', () => {
    expect(isLateCancel(at(2 * HOUR), now)).toBe(false);
    expect(isLateCancel(at(2 * HOUR - 1), now)).toBe(true);
    expect(isLateCancel(at(MINUTE), now)).toBe(true);
  });

  it('is not late at or after the start (the lobby has started)', () => {
    expect(isLateCancel(now, now)).toBe(false);
    expect(isLateCancel(at(-MINUTE), now)).toBe(false);
  });
});

describe('meetsMinKarma', () => {
  it('is inclusive and open without a threshold', () => {
    expect(meetsMinKarma(50, 50)).toBe(true);
    expect(meetsMinKarma(49, 50)).toBe(false);
    expect(meetsMinKarma(-100, null)).toBe(true);
  });
});

describe('place rules', () => {
  it('classifies the distance to the nearest station', () => {
    expect(classifyMetroDistance(0)).toBe('near');
    expect(classifyMetroDistance(1500)).toBe('near');
    expect(classifyMetroDistance(1500.1)).toBe('far');
    expect(classifyMetroDistance(5000)).toBe('far');
    expect(classifyMetroDistance(5000.1)).toBe('too_far');
    expect(PLACE_TOO_FAR_MESSAGE).toBe('Пока поддерживаем места не дальше 5 км от метро или МЦК');
  });

  it('checks Moscow bounds inclusively', () => {
    expect(isInMoscowBounds({ lat: 55.7539, lng: 37.6208 })).toBe(true);
    expect(isInMoscowBounds({ lat: 55.1, lng: 36.8 })).toBe(true);
    expect(isInMoscowBounds({ lat: 56.05, lng: 38.0 })).toBe(true);
    expect(isInMoscowBounds({ lat: 59.9386, lng: 30.3141 })).toBe(false);
    expect(isInMoscowBounds({ lat: 55.7539, lng: 38.0001 })).toBe(false);
    expect(isInMoscowBounds({ lat: 55.0999, lng: 37.6208 })).toBe(false);
  });
});

describe('rounding', () => {
  it('rounds viewer coordinates to 3 decimals', () => {
    expect(roundViewerCoord(55.75391)).toBe(55.754);
    expect(roundViewerCoord(37.62049)).toBe(37.62);
    expect(roundViewerCoord(55.7)).toBe(55.7);
  });

  it('is idempotent and moves a coordinate by at most half a step', () => {
    for (let i = 0; i < 2000; i++) {
      const value = 55 + i * 0.000731;
      const once = roundViewerCoord(value);
      expect(roundViewerCoord(once)).toBe(once);
      expect(Math.abs(once - value)).toBeLessThanOrEqual(0.0005 + 1e-9);
    }
  });

  it('rounds distances to 100 m', () => {
    expect(roundDistance(0)).toBe(0);
    expect(roundDistance(49)).toBe(0);
    expect(roundDistance(2449)).toBe(2400);
    expect(roundDistance(2450)).toBe(2500);
    expect(roundDistance(12_034.7)).toBe(12_000);
  });
});

describe('isHostLateCancel', () => {
  const lobby = (startsIn: number, approvedCount: number) => ({
    startsAt: at(startsIn),
    slots: 3,
    approvedCount,
  });

  it('penalizes only a full lobby within the last hour', () => {
    expect(isHostLateCancel(lobby(59 * MINUTE, 3), now)).toBe(true);
    expect(isHostLateCancel(lobby(59 * MINUTE, 2), now)).toBe(false);
    expect(isHostLateCancel(lobby(HOUR, 3), now)).toBe(false);
    expect(isHostLateCancel(lobby(2 * HOUR, 3), now)).toBe(false);
  });
});

describe('lowerMinKarma', () => {
  it('steps down one preset and drops the threshold below the lowest', () => {
    expect(lowerMinKarma(80)).toBe(70);
    expect(lowerMinKarma(55)).toBe(50);
    expect(lowerMinKarma(50)).toBe(40);
    expect(lowerMinKarma(40)).toBeNull();
    expect(lowerMinKarma(20)).toBeNull();
    expect(lowerMinKarma(100)).toBe(80);
  });
});

describe('checkInWindow', () => {
  const lobby = { startsAt: at(HOUR), endsAt: at(3 * HOUR) };

  it('opens 30 minutes before the start and closes at the end', () => {
    expect(checkInWindow(lobby, at(29 * MINUTE))).toBe('not_open');
    expect(checkInWindow(lobby, at(30 * MINUTE))).toBe('open');
    expect(checkInWindow(lobby, at(3 * HOUR - 1))).toBe('open');
    expect(checkInWindow(lobby, at(3 * HOUR))).toBe('closed');
  });
});

describe('attendanceState', () => {
  const base = {
    status: 'finished' as const,
    endsAt: now,
    attendanceSavedAt: null,
    attendanceClosedAt: null,
  };

  it('is open from the end for 48 hours unless saved or closed', () => {
    expect(attendanceDeadline(now).getTime() - now.getTime()).toBe(48 * HOUR);
    expect(attendanceState({ ...base, status: 'active' }, at(-1))).toBe('not_yet');
    expect(attendanceState(base, now)).toBe('open');
    expect(attendanceState(base, at(48 * HOUR - 1))).toBe('open');
    expect(attendanceState(base, at(48 * HOUR))).toBe('closed');
    expect(attendanceState({ ...base, attendanceSavedAt: now }, at(HOUR))).toBe('saved');
    expect(attendanceState({ ...base, attendanceClosedAt: now }, at(HOUR))).toBe('closed');
    expect(attendanceState({ ...base, status: 'cancelled' }, at(HOUR))).toBe('not_yet');
  });
});

describe('appealRetryAt', () => {
  it('allows the next appeal 7 days after a rejection', () => {
    expect(appealRetryAt(now).getTime() - now.getTime()).toBe(7 * DAY);
  });
});
