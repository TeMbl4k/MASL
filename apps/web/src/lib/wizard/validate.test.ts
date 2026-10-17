import {
  OUTSIDE_MOSCOW_MESSAGE,
  PLACE_TOO_FAR_MESSAGE,
  START_ISSUE_MESSAGES,
  validateLobbyStart,
} from '@masl/shared';
import { nearestStation } from '@masl/shared/metro';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultStart, instantOf, quickStarts } from './defaults.js';
import { firstInvalidStep, startsAtOf, stepIssues, toCreateInput, type DraftValues } from './validate.js';

// The device clock is in New York; the wizard still works in Moscow time.
const previousTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  process.env.TZ = previousTz;
});

/** Saturday 17 October 2026, 15:00 in Moscow. */
const NOW = new Date('2026-10-17T12:00:00Z');
/** About 800 m from «Динамо». */
const NEAR_DYNAMO = { lat: 55.7966, lng: 37.5535 };
/** Zelenograd: inside MOSCOW_BOUNDS, far from any metro station. */
const ZELENOGRAD = { lat: 55.9825, lng: 37.1944 };

const valid: DraftValues = {
  requestId: '0f8c2a9e-4b1d-4c3e-9a7f-2d5b6c8e1f00',
  category: 'sport',
  title: '  Падел 2×2  ',
  description: '',
  day: '2026-10-18',
  hour: 19,
  minute: 30,
  durationMinutes: 120,
  point: NEAR_DYNAMO,
  address: 'Ленинградский пр., 36',
  slots: 3,
  minKarmaOn: false,
  minKarma: 40,
  paymentFormat: 'split',
};

describe('stepIssues', () => {
  it('passes a complete draft on every step', () => {
    expect(stepIssues(1, valid, NOW)).toEqual({});
    expect(stepIssues(2, valid, NOW, nearestStation)).toEqual({});
    expect(stepIssues(3, valid, NOW)).toEqual({});
    expect(firstInvalidStep(valid, NOW, nearestStation)).toBeNull();
  });

  it('step 1: category and title, with the shared schema messages', () => {
    expect(stepIssues(1, { ...valid, category: null, title: ' ab ' }, NOW)).toEqual({
      category: 'Выберите категорию',
      title: 'Название — от 3 символов',
    });
    expect(stepIssues(1, { ...valid, title: 'x'.repeat(81) }, NOW).title).toBe('Название — до 80 символов');
    expect(stepIssues(1, { ...valid, description: 'x'.repeat(1001) }, NOW).description).toBe(
      'Описание — до 1000 символов',
    );
  });

  it('step 2: pin, address and the start window', () => {
    expect(stepIssues(2, { ...valid, point: null, address: ' ' }, NOW)).toEqual({
      location: 'Поставьте точку на карте',
      address: 'Укажите адрес',
    });
    // 15:10 today: less than 15 minutes ahead.
    expect(stepIssues(2, { ...valid, day: '2026-10-17', hour: 15, minute: 10 }, NOW).startsAt).toBe(
      START_ISSUE_MESSAGES.starts_too_soon,
    );
    expect(
      stepIssues(2, { ...valid, day: '2026-10-17', hour: 15, minute: 15 }, NOW).startsAt,
    ).toBeUndefined();
    expect(stepIssues(2, { ...valid, day: '2026-11-16', hour: 15, minute: 5 }, NOW).startsAt).toBe(
      START_ISSUE_MESSAGES.starts_too_far,
    );
  });

  it('step 2: outside Moscow and too far from the metro', () => {
    expect(stepIssues(2, { ...valid, point: { lat: 59.94, lng: 30.31 } }, NOW, nearestStation).location).toBe(
      OUTSIDE_MOSCOW_MESSAGE,
    );
    expect(stepIssues(2, { ...valid, point: ZELENOGRAD }, NOW, nearestStation).location).toBe(
      PLACE_TOO_FAR_MESSAGE,
    );
    // Without the metro data the distance rule is left to the server.
    expect(stepIssues(2, { ...valid, point: ZELENOGRAD }, NOW).location).toBeUndefined();
  });

  it('step 3: slots and the karma threshold only when it is on', () => {
    expect(stepIssues(3, { ...valid, slots: 0 }, NOW).slots).toBeDefined();
    expect(stepIssues(3, { ...valid, slots: 51 }, NOW).slots).toBeDefined();
    expect(stepIssues(3, { ...valid, minKarma: 101 }, NOW)).toEqual({});
    expect(stepIssues(3, { ...valid, minKarmaOn: true, minKarma: 101 }, NOW).minKarma).toBeDefined();
  });

  it('finds the first step to fix', () => {
    expect(firstInvalidStep({ ...valid, point: null, slots: 0 }, NOW, nearestStation)).toBe(2);
    expect(firstInvalidStep({ ...valid, title: '', point: null }, NOW, nearestStation)).toBe(1);
    expect(firstInvalidStep({ ...valid, slots: 0 }, NOW, nearestStation)).toBe(3);
  });
});

describe('toCreateInput', () => {
  it('builds the normalised API input', () => {
    expect(toCreateInput({ ...valid, minKarmaOn: true })).toEqual({
      requestId: valid.requestId,
      category: 'sport',
      title: 'Падел 2×2',
      description: null,
      startsAt: '2026-10-18T16:30:00.000Z',
      durationMinutes: 120,
      location: NEAR_DYNAMO,
      address: 'Ленинградский пр., 36',
      slots: 3,
      minKarma: 40,
      paymentFormat: 'split',
    });
  });

  it('gives null for an incomplete draft', () => {
    expect(toCreateInput({ ...valid, point: null })).toBeNull();
  });

  it('reads the start as Moscow wall time whatever the device zone', () => {
    expect(startsAtOf({ day: '2026-10-17', hour: 0, minute: 30 })).toBe('2026-10-16T21:30:00.000Z');
    expect(startsAtOf({ day: '2026-02-30', hour: 0, minute: 30 })).toBeNull();
  });
});

const at = (iso: string) => new Date(iso);

describe('defaultStart', () => {
  it('is the next half hour at least an hour ahead', () => {
    // 15:00 → 16:00; 15:01 → 16:30; 15:30 → 16:30.
    expect(defaultStart(NOW)).toEqual({ day: '2026-10-17', hour: 16, minute: 0 });
    expect(defaultStart(at('2026-10-17T12:01:00Z'))).toEqual({ day: '2026-10-17', hour: 16, minute: 30 });
    expect(defaultStart(at('2026-10-17T12:30:00Z'))).toEqual({ day: '2026-10-17', hour: 16, minute: 30 });
  });

  it('moves to tomorrow 19:00 late at night', () => {
    // 23:10 Moscow.
    expect(defaultStart(at('2026-10-17T20:10:00Z'))).toEqual({ day: '2026-10-18', hour: 19, minute: 0 });
    // 22:40: an hour ahead would be past midnight.
    expect(defaultStart(at('2026-10-17T19:40:00Z'))).toEqual({ day: '2026-10-18', hour: 19, minute: 0 });
    // 22:20 → 23:30 still today.
    expect(defaultStart(at('2026-10-17T19:20:00Z'))).toEqual({ day: '2026-10-17', hour: 23, minute: 30 });
  });

  it('is always a valid start', () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 7) {
      const now = new Date(NOW.getTime() + minutes * 60_000);
      expect(validateLobbyStart(instantOf(defaultStart(now)), now)).toBeNull();
    }
  });
});

describe('quickStarts', () => {
  it('offers the evening chip only before 18:45', () => {
    expect(quickStarts(NOW).map((chip) => chip.label)).toEqual([
      'Через 30 мин',
      'Через час',
      'Вечером в 19:00',
    ]);
    // 18:45 Moscow.
    expect(quickStarts(at('2026-10-17T15:45:00Z')).map((chip) => chip.label)).toEqual([
      'Через 30 мин',
      'Через час',
    ]);
  });

  it('rounds up to the time picker grid and stays valid', () => {
    // 15:02 → 15:35 and 16:05.
    const chips = quickStarts(at('2026-10-17T12:02:00Z'));
    expect(chips[0].start).toEqual({ day: '2026-10-17', hour: 15, minute: 35 });
    expect(chips[1].start).toEqual({ day: '2026-10-17', hour: 16, minute: 5 });
    for (let minutes = 0; minutes < 24 * 60; minutes += 11) {
      const now = new Date(NOW.getTime() + minutes * 60_000);
      for (const chip of quickStarts(now)) {
        expect(validateLobbyStart(instantOf(chip.start), now)).toBeNull();
        expect(chip.start.minute % 5).toBe(0);
      }
    }
  });

  it('crosses midnight on the Moscow day', () => {
    // 23:50 Moscow → 00:20 tomorrow.
    expect(quickStarts(at('2026-10-17T20:50:00Z'))[0].start).toEqual({
      day: '2026-10-18',
      hour: 0,
      minute: 20,
    });
  });
});
