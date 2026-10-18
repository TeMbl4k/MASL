import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayChips,
  formatCountdown,
  formatDuration,
  formatLobbyDay,
  formatLobbyStart,
  formatLobbyWhen,
  formatShortDate,
  formatTimeAgo,
  relativeDayName,
} from './datetime.js';
import { lobbyStatusPill } from './labels.js';

// The device clock is in New York; every label must still follow Moscow days.
const previousTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  process.env.TZ = previousTz;
});

/** Friday 16 October 2026, 23:30 in Moscow; still 16:30 on Friday in New York. */
const NOW = new Date('2026-10-16T20:30:00Z');

describe('Moscow day boundaries', () => {
  it('names today and tomorrow by the Moscow day, not the device day', () => {
    expect(relativeDayName('2026-10-16T20:59:00Z', NOW)).toBe('Сегодня');
    // 00:30 on Saturday in Moscow, 17:30 on Friday in New York.
    expect(relativeDayName('2026-10-16T21:30:00Z', NOW)).toBe('Завтра');
    expect(relativeDayName('2026-10-17T21:00:00Z', NOW)).toBeNull();
  });

  it('formats card times', () => {
    expect(formatLobbyStart('2026-10-16T20:45:00Z', NOW)).toBe('Сегодня, 23:45');
    expect(formatLobbyStart('2026-10-16T21:30:00Z', NOW)).toBe('Завтра, 00:30');
    expect(formatLobbyStart('2026-10-18T16:30:00Z', NOW)).toBe('Вс, 18 окт., 19:30');
  });

  it('names the day of a start for compact rows', () => {
    expect(formatLobbyDay('2026-10-16T20:45:00Z', NOW)).toBe('Сегодня');
    expect(formatLobbyDay('2026-10-16T21:30:00Z', NOW)).toBe('Завтра');
    expect(formatLobbyDay('2026-10-18T16:30:00Z', NOW)).toBe('Вс, 18 окт.');
  });

  it('formats the lobby page range', () => {
    expect(formatLobbyWhen('2026-10-17T16:30:00Z', '2026-10-17T18:30:00Z', NOW)).toBe(
      'Завтра, сб 17 октября · 19:30–21:30',
    );
    expect(formatLobbyWhen('2026-10-18T17:00:00Z', '2026-10-18T19:00:00Z', NOW)).toBe(
      'Вс, 18 октября · 20:00–22:00',
    );
  });

  it('builds day strip chips from the Moscow today', () => {
    const chips = dayChips(NOW, 3);
    expect(chips.map((c) => c.day)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18']);
    expect(chips.map((c) => c.name)).toEqual(['Сегодня', 'Завтра', 'Вс']);
    expect(chips[2]).toMatchObject({ date: 18, month: 'октябрь', ariaLabel: 'воскресенье, 18 октября' });
  });

  it('crosses a month boundary', () => {
    const chips = dayChips('2026-10-31T09:00:00Z', 2);
    expect(chips.map((c) => [c.day, c.date, c.month])).toEqual([
      ['2026-10-31', 31, 'октябрь'],
      ['2026-11-01', 1, 'ноябрь'],
    ]);
  });
});

describe('countdown and relative times', () => {
  it('counts down in hours and minutes, rounding up', () => {
    expect(formatCountdown('2026-10-16T22:45:00Z', NOW)).toBe('Через 2 ч 15 мин');
    expect(formatCountdown('2026-10-16T21:30:00Z', NOW)).toBe('Через 1 ч');
    expect(formatCountdown('2026-10-16T20:30:01Z', NOW)).toBe('Через 1 мин');
    expect(formatCountdown(NOW, NOW)).toBeNull();
  });

  it('says how long ago', () => {
    expect(formatTimeAgo('2026-10-16T20:29:30Z', NOW)).toBe('только что');
    expect(formatTimeAgo('2026-10-16T20:25:00Z', NOW)).toBe('5 мин назад');
    expect(formatTimeAgo('2026-10-16T17:00:00Z', NOW)).toBe('3 ч назад');
    // 22:00 on Thursday in Moscow.
    expect(formatTimeAgo('2026-10-15T19:00:00Z', NOW)).toBe('вчера');
    expect(formatTimeAgo('2026-10-12T10:00:00Z', NOW)).toBe('12 окт.');
    expect(formatShortDate('2026-10-12T10:00:00Z')).toBe('12 окт.');
  });

  it('formats durations', () => {
    expect([45, 60, 90, 120, 75, 360].map(formatDuration)).toEqual([
      '45 мин',
      '1 ч',
      '1,5 ч',
      '2 ч',
      '1 ч 15 мин',
      '6 ч',
    ]);
  });
});

describe('lobbyStatusPill', () => {
  const lobby = {
    status: 'open' as const,
    startsAt: '2026-10-17T16:30:00Z',
    endsAt: '2026-10-17T18:30:00Z',
    slots: 4,
    approvedCount: 1,
  };

  it('shows «Набор» more than 3 h before the start and a countdown after', () => {
    expect(lobbyStatusPill(lobby, NOW)).toEqual({ text: 'Набор', tone: 'open' });
    expect(lobbyStatusPill(lobby, '2026-10-17T14:15:00Z')).toEqual({
      text: 'Через 2 ч 15 мин',
      tone: 'soon',
    });
  });

  it('marks a full lobby, then follows the clock to active and finished', () => {
    expect(lobbyStatusPill({ ...lobby, approvedCount: 4 }, NOW).text).toBe('Состав собран');
    expect(lobbyStatusPill(lobby, '2026-10-17T17:00:00Z').text).toBe('Идёт');
    expect(lobbyStatusPill(lobby, '2026-10-17T18:30:00Z').text).toBe('Завершена');
  });

  it('keeps a cancelled lobby cancelled', () => {
    expect(lobbyStatusPill({ ...lobby, status: 'cancelled' }, '2026-10-17T17:00:00Z')).toEqual({
      text: 'Отменена',
      tone: 'cancelled',
    });
  });
});
