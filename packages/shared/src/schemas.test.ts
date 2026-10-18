import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  FEED_PAGE_SIZE,
  LOBBY_DEFAULT_SLOTS,
  LOBBY_DURATION_DEFAULT_MINUTES,
  LOBBY_DURATION_PRESETS_MINUTES,
  LOBBY_MIN_KARMA_PRESETS,
  LOBBY_SLOTS_PRESETS,
} from './constants.js';
import {
  API_ERROR_CODES,
  CASE_DECISIONS,
  LOBBY_ACCESS,
  LOBBY_CATEGORIES,
  MODERATION_CASE_KINDS,
  MODERATION_DECISIONS,
} from './enums.js';
import { INTERESTS, INTEREST_SLUGS } from './interests.js';
import {
  adminCaseDto,
  adminLobbyDto,
  adminUserSearchQuery,
  apiErrorDto,
  appealInput,
  appealStateDto,
  applicantDto,
  attendanceInput,
  attendanceResponse,
  checkInInput,
  cancelLobbyInput,
  createLobbyInput,
  feedQuery,
  feedResponse,
  idParam,
  lobbyCardDto,
  lobbyDetailDto,
  lobbyEssenceInput,
  lobbyTermsInput,
  lobbyWhenWhereInput,
  mapQuery,
  mapResponse,
  myLobbiesResponse,
  onboardingInput,
  originQuery,
  placeReverseInput,
  placeSuggestInput,
  reportInput,
  resolveCaseInput,
  updateInterestsInput,
  userActionInput,
} from './schemas.js';

describe('onboardingInput', () => {
  const valid = { gender: 'female', age: 24, interests: ['sport', 'bars', 'networking'] };

  it('accepts valid onboarding input', () => {
    expect(onboardingInput.parse(valid)).toEqual(valid);
  });

  it('requires 3 to 5 unique interests', () => {
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'bars'] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, interests: INTEREST_SLUGS.slice(0, 6) }).success).toBe(
      false,
    );
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'sport', 'bars'] }).success).toBe(
      false,
    );
  });

  it('rejects an unknown interest, age outside 18–99 and a fractional age', () => {
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'bars', 'nope'] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 17 }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 100 }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 20.5 }).success).toBe(false);
  });
});

describe('reference data', () => {
  it('every interest is a lobby category (for the "For you" feed)', () => {
    for (const interest of INTERESTS) {
      expect(LOBBY_CATEGORIES).toContain(interest.slug);
    }
  });

  it('interest slugs are unique', () => {
    expect(new Set(INTEREST_SLUGS).size).toBe(INTEREST_SLUGS.length);
  });
});

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;
const REQUEST_ID = '6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f';

describe('createLobbyInput', () => {
  const valid = {
    category: 'sport',
    title: 'Падел 2×2',
    description: 'Берите ракетки',
    startsAt: '2026-10-18T19:30:00+03:00',
    durationMinutes: 120,
    location: { lat: 55.7897, lng: 37.5582 },
    address: 'Ленинградский проспект, 36',
    slots: 3,
    minKarma: 40,
    paymentFormat: 'split',
    requestId: REQUEST_ID,
  };
  const withField = (key: string, value: unknown) => ({ ...valid, [key]: value });

  it('accepts a valid lobby', () => {
    expect(createLobbyInput.parse(valid)).toEqual(valid);
  });

  it('normalises the title: trimmed, NFC, without bidi and control characters', () => {
    const title = `  ${ch(0x202e)}Мои${ch(0x306)} падел${ch(0)}\n `;
    expect(createLobbyInput.parse(withField('title', title)).title).toBe('Мой падел');
  });

  it('checks the title length after normalisation and rejects a mark flood', () => {
    expect(ok(createLobbyInput, withField('title', 'Аб'))).toBe(false);
    expect(ok(createLobbyInput, withField('title', '  Аб  '))).toBe(false);
    expect(ok(createLobbyInput, withField('title', 'Абв'))).toBe(true);
    expect(ok(createLobbyInput, withField('title', 'а'.repeat(80)))).toBe(true);
    expect(ok(createLobbyInput, withField('title', 'а'.repeat(81)))).toBe(false);
    expect(ok(createLobbyInput, withField('title', `Za${ch(0x334, 0x335, 0x336)}lgo`))).toBe(false);
  });

  it('rejects titles and addresses that look blank', () => {
    const zwj = ch(0x200d);
    const vs16 = ch(0xfe0f);
    for (const blank of [
      zwj.repeat(3),
      `${zwj} ${zwj} ${zwj}`,
      ch(0x3164).repeat(3),
      ch(0x2800).repeat(3),
      ch(0x115f, 0x1160, 0x3164),
      `${vs16} ${vs16} ${vs16}`,
      `${vs16}${zwj}${vs16}${zwj}${vs16}`,
      // One visible letter padded with variation selectors.
      `а${vs16}${vs16}`,
    ]) {
      expect(ok(createLobbyInput, withField('title', blank))).toBe(false);
      expect(ok(createLobbyInput, withField('address', blank))).toBe(false);
    }
  });

  it('turns a missing or blank description into null and caps its length', () => {
    expect(createLobbyInput.parse(withField('description', '')).description).toBeNull();
    expect(createLobbyInput.parse(withField('description', ' \n ')).description).toBeNull();
    expect(createLobbyInput.parse(withField('description', null)).description).toBeNull();
    const { description: _omitted, ...withoutDescription } = valid;
    expect(createLobbyInput.parse(withoutDescription).description).toBeNull();
    expect(ok(createLobbyInput, withField('description', 'а'.repeat(1000)))).toBe(true);
    expect(ok(createLobbyInput, withField('description', 'а'.repeat(1001)))).toBe(false);
  });

  it('keeps description line breaks', () => {
    expect(createLobbyInput.parse(withField('description', 'Раз\n\n\n\n\nДва')).description).toBe(
      'Раз\n\n\nДва',
    );
  });

  it('limits slots to whole numbers 1–50', () => {
    for (const slots of [0, 51, 2.5, '3']) {
      expect(ok(createLobbyInput, withField('slots', slots))).toBe(false);
    }
    expect(ok(createLobbyInput, withField('slots', 1))).toBe(true);
    expect(ok(createLobbyInput, withField('slots', 50))).toBe(true);
  });

  it('limits minKarma to 0–100 or null', () => {
    expect(ok(createLobbyInput, withField('minKarma', -1))).toBe(false);
    expect(ok(createLobbyInput, withField('minKarma', 101))).toBe(false);
    expect(ok(createLobbyInput, withField('minKarma', 100))).toBe(true);
    expect(ok(createLobbyInput, withField('minKarma', null))).toBe(true);
  });

  it('limits the duration to 30–720 minutes in 15-minute steps', () => {
    for (const minutes of [29, 735, 50, 0]) {
      expect(ok(createLobbyInput, withField('durationMinutes', minutes))).toBe(false);
    }
    expect(ok(createLobbyInput, withField('durationMinutes', 30))).toBe(true);
    expect(ok(createLobbyInput, withField('durationMinutes', 720))).toBe(true);
  });

  it('rejects a point outside Moscow, an unknown category and a missing requestId', () => {
    const outside = createLobbyInput.safeParse(withField('location', { lat: 59.9386, lng: 30.3141 }));
    expect(outside.success).toBe(false);
    expect(outside.error?.issues.map((i) => i.message)).toContain('Пока работаем только в Москве');
    expect(ok(createLobbyInput, withField('location', null))).toBe(false);
    expect(ok(createLobbyInput, withField('category', 'knitting'))).toBe(false);
    const { requestId: _omitted, ...withoutRequestId } = valid;
    expect(ok(createLobbyInput, withoutRequestId)).toBe(false);
    expect(ok(createLobbyInput, withField('requestId', 'not-a-uuid'))).toBe(false);
  });

  it('requires an explicit offset on startsAt', () => {
    expect(ok(createLobbyInput, withField('startsAt', '2026-10-18T19:30:00'))).toBe(false);
    expect(ok(createLobbyInput, withField('startsAt', '2026-10-18T16:30:00.000Z'))).toBe(true);
    expect(ok(createLobbyInput, withField('startsAt', 'завтра'))).toBe(false);
  });

  it('checks the address length after normalisation', () => {
    expect(ok(createLobbyInput, withField('address', ' ул '))).toBe(false);
    expect(ok(createLobbyInput, withField('address', 'а'.repeat(200)))).toBe(true);
    expect(ok(createLobbyInput, withField('address', 'а'.repeat(201)))).toBe(false);
  });

  it('strips fields the server derives or takes from the session', () => {
    const parsed = createLobbyInput.parse({
      ...valid,
      hostId: REQUEST_ID,
      status: 'cancelled',
      placeHint: 'м. Кремль',
      publicLocation: { lat: 55.75, lng: 37.61 },
      metroStationId: '1-kreml',
      karma: 100,
    });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(valid).sort());
  });

  it('accepts every wizard preset and default', () => {
    for (const durationMinutes of [...LOBBY_DURATION_PRESETS_MINUTES, LOBBY_DURATION_DEFAULT_MINUTES]) {
      expect(ok(createLobbyInput, withField('durationMinutes', durationMinutes))).toBe(true);
    }
    for (const slots of [...LOBBY_SLOTS_PRESETS, LOBBY_DEFAULT_SLOTS]) {
      expect(ok(createLobbyInput, withField('slots', slots))).toBe(true);
    }
    for (const minKarma of LOBBY_MIN_KARMA_PRESETS) {
      expect(ok(createLobbyInput, withField('minKarma', minKarma))).toBe(true);
    }
  });

  it('is composed of the three wizard steps', () => {
    const keys = [
      ...Object.keys(lobbyEssenceInput.shape),
      ...Object.keys(lobbyWhenWhereInput.shape),
      ...Object.keys(lobbyTermsInput.shape),
      'requestId',
    ];
    expect(Object.keys(createLobbyInput.shape).sort()).toEqual(keys.sort());
  });
});

describe('cancelLobbyInput', () => {
  it('accepts a known reason with an optional comment', () => {
    expect(cancelLobbyInput.parse({ reason: 'plans_changed' })).toEqual({
      reason: 'plans_changed',
      comment: null,
    });
    expect(cancelLobbyInput.parse({ reason: 'other', comment: '  ' })).toEqual({
      reason: 'other',
      comment: null,
    });
    expect(cancelLobbyInput.parse({ reason: 'other', comment: ' Заболел ' }).comment).toBe('Заболел');
    expect(ok(cancelLobbyInput, { reason: 'bored' })).toBe(false);
    expect(ok(cancelLobbyInput, { reason: 'other', comment: 'а'.repeat(201) })).toBe(false);
    expect(cancelLobbyInput.parse({ reason: 'other', comment: ch(0x200d) }).comment).toBeNull();
  });
});

describe('stage 3 inputs', () => {
  it('takes a list of distinct application ids as absent', () => {
    expect(ok(attendanceInput, { absentApplicationIds: [] })).toBe(true);
    expect(ok(attendanceInput, { absentApplicationIds: [REQUEST_ID] })).toBe(true);
    expect(ok(attendanceInput, { absentApplicationIds: [REQUEST_ID, REQUEST_ID] })).toBe(false);
    expect(ok(attendanceInput, { absentApplicationIds: ['1'] })).toBe(false);
    expect(ok(attendanceInput, {})).toBe(false);
  });

  it('takes any point on Earth for a check-in', () => {
    expect(ok(checkInInput, { lat: 59.93, lng: 30.31 })).toBe(true);
    expect(ok(checkInInput, { lat: 91, lng: 0 })).toBe(false);
    expect(ok(checkInInput, { lat: '55.7', lng: 37.6 })).toBe(false);
  });
});

describe('query schemas', () => {
  it('feedQuery needs both coordinates or none', () => {
    expect(ok(feedQuery, { lat: '55.75' })).toBe(false);
    expect(ok(feedQuery, { lng: '37.62' })).toBe(false);
    expect(feedQuery.parse({ lat: '55.75', lng: '37.62' })).toMatchObject({ lat: 55.75, lng: 37.62 });
    expect(feedQuery.parse({})).toEqual({ limit: FEED_PAGE_SIZE });
  });

  it('feedQuery treats empty parameters as missing', () => {
    expect(feedQuery.parse({ lat: '', lng: '', category: '', day: '', cursor: '', limit: '' })).toEqual({
      limit: FEED_PAGE_SIZE,
    });
  });

  it('feedQuery rounds the origin to 3 decimals', () => {
    expect(feedQuery.parse({ lat: '55.789712', lng: '37.558249' })).toMatchObject({
      lat: 55.79,
      lng: 37.558,
    });
    expect(originQuery.parse({ lat: '55.789712', lng: '37.558249' })).toEqual({ lat: 55.79, lng: 37.558 });
  });

  it('originQuery needs both coordinates or none', () => {
    expect(ok(originQuery, { lat: '55.75' })).toBe(false);
    expect(ok(originQuery, { lng: '37.62' })).toBe(false);
    expect(originQuery.parse({})).toEqual({});
    expect(originQuery.parse({ lat: '', lng: '' })).toEqual({});
  });

  it('feedQuery rejects bad limits, days, categories and coordinates', () => {
    expect(feedQuery.parse({ limit: '50' }).limit).toBe(50);
    for (const query of [
      { limit: '1000' },
      { limit: '0' },
      { limit: '2.5' },
      { day: '2026-02-30' },
      { day: '17.10.2026' },
      // PostgreSQL has no year 0, and Date.UTC maps years 0–99 to the 1900s.
      { day: '0000-01-01' },
      { day: '0050-01-01' },
      { day: '1999-12-31' },
      { day: '2100-01-01' },
      { category: 'knitting' },
      { lat: 'NaN', lng: '37.62' },
      { lat: ['55.75', '55.76'], lng: '37.62' },
      { lat: '59.93', lng: '30.31' },
      { cursor: 'x'.repeat(513) },
    ]) {
      expect(ok(feedQuery, query)).toBe(false);
    }
    expect(feedQuery.parse({ day: '2026-10-17', category: 'sport' })).toMatchObject({
      day: '2026-10-17',
      category: 'sport',
    });
    expect(feedQuery.parse({ day: '2000-01-01' }).day).toBe('2000-01-01');
    expect(feedQuery.parse({ day: '2099-12-31' }).day).toBe('2099-12-31');
  });

  it('mapQuery takes only category and day', () => {
    expect(mapQuery.parse({ category: '', day: '2026-10-17', lat: '55.7' })).toEqual({ day: '2026-10-17' });
    expect(ok(mapQuery, { day: '0000-01-01' })).toBe(false);
  });

  it('placeSuggestInput and placeReverseInput validate their input', () => {
    expect(placeSuggestInput.parse({ q: '  Тверская  1 ' })).toEqual({ q: 'Тверская 1' });
    expect(ok(placeSuggestInput, { q: 'Тв' })).toBe(false);
    expect(ok(placeSuggestInput, { q: 'а'.repeat(500) })).toBe(false);
    expect(ok(placeSuggestInput, { q: ch(0x200d).repeat(3) })).toBe(false);
    expect(placeReverseInput.parse({ lat: 55.789712, lng: 37.558249 })).toEqual({
      lat: 55.789712,
      lng: 37.558249,
    });
    expect(ok(placeReverseInput, { lat: '55.789712', lng: '37.558249' })).toBe(false);
    expect(ok(placeReverseInput, { lat: 59.93, lng: 30.31 })).toBe(false);
    expect(ok(placeReverseInput, {})).toBe(false);
  });

  it('idParam accepts only UUIDs', () => {
    expect(ok(idParam, REQUEST_ID)).toBe(true);
    expect(ok(idParam, '..%2Fme')).toBe(false);
    expect(ok(idParam, '42')).toBe(false);
  });

  it('updateInterestsInput uses the onboarding interest rules', () => {
    expect(ok(updateInterestsInput, { interests: ['sport', 'bars', 'food'] })).toBe(true);
    expect(ok(updateInterestsInput, { interests: ['sport', 'sport', 'food'] })).toBe(false);
    expect(ok(updateInterestsInput, { interests: ['sport', 'bars'] })).toBe(false);
  });
});

describe('response schemas fail closed', () => {
  const card = {
    id: REQUEST_ID,
    category: 'sport',
    title: 'Падел 2×2',
    startsAt: '2026-10-18T16:30:00.000Z',
    endsAt: '2026-10-18T18:30:00.000Z',
    status: 'open',
    slots: 3,
    approvedCount: 1,
    pendingCount: null,
    minKarma: null,
    paymentFormat: 'free',
    place: {
      hint: 'м. Динамо',
      stationId: '2-dinamo',
      lineName: 'Замоскворецкая',
      lineColor: '#4FB04F',
      point: { lat: 55.7897, lng: 37.5582 },
      farFromMetro: false,
    },
    distanceM: 2400,
    host: { firstName: 'Анна', photoUrl: null, karma: 50 },
    viewer: { isHost: false, membershipStatus: null, applyBlock: null, reported: false },
  };
  const detail = {
    ...card,
    description: null,
    cancelReason: null,
    cancelComment: null,
    members: null,
    chat: null,
    cancelPolicy: null,
    checkIn: null,
    attendance: null,
  };
  const exactPlace = { address: 'CANARY-ул. Тестовая, 1', point: { lat: 55.7951, lng: 37.5502 } };

  it('accepts a valid card and rejects unknown keys at any depth', () => {
    expect(ok(lobbyCardDto, card)).toBe(true);
    expect(ok(lobbyCardDto, { ...card, address: exactPlace.address })).toBe(false);
    expect(ok(lobbyCardDto, { ...card, place: { ...card.place, address: exactPlace.address } })).toBe(false);
    expect(ok(lobbyCardDto, { ...card, host: { ...card.host, id: REQUEST_ID } })).toBe(false);
    expect(ok(lobbyCardDto, { ...card, place: { ...card.place, lineColor: 'red' } })).toBe(false);
  });

  it('keeps strictness on objects extended from strict ones', () => {
    expect(ok(lobbyDetailDto, { ...detail, access: 'public' })).toBe(true);
    expect(ok(lobbyDetailDto, { ...detail, access: 'public', location: exactPlace.point })).toBe(false);
    const applicant = {
      applicationId: REQUEST_ID,
      status: 'pending',
      appliedAt: '2026-10-17T12:00:00.000Z',
      decidedAt: null,
      user: { ...card.host, isNewbie: true },
      meetsMinKarma: true,
    };
    expect(ok(applicantDto, applicant)).toBe(true);
    expect(ok(applicantDto, { ...applicant, user: { ...applicant.user, telegramId: 1 } })).toBe(false);
  });

  it('gives the exact place only to member and host access', () => {
    expect(ok(lobbyDetailDto, { ...detail, access: 'public', exactPlace })).toBe(false);
    expect(ok(lobbyDetailDto, { ...detail, access: 'member' })).toBe(false);
    expect(ok(lobbyDetailDto, { ...detail, access: 'member', exactPlace })).toBe(true);
    expect(ok(lobbyDetailDto, { ...detail, access: 'host', exactPlace })).toBe(true);
    expect(ok(lobbyDetailDto, { ...detail, access: 'admin', exactPlace })).toBe(false);
    expect(lobbyDetailDto.options.map((option) => option.shape.access.value)).toEqual([...LOBBY_ACCESS]);
  });

  it('keeps the stage 3 detail parts strict', () => {
    const chat = { state: 'linked', title: 'Падел', inviteLink: 'https://t.me/+abc' };
    expect(ok(lobbyDetailDto, { ...detail, access: 'member', exactPlace, chat })).toBe(true);
    expect(
      ok(lobbyDetailDto, { ...detail, access: 'member', exactPlace, chat: { ...chat, chatId: 1 } }),
    ).toBe(false);
    const checkIn = { opensAt: card.startsAt, closesAt: card.endsAt, checkedInAt: null };
    expect(ok(lobbyDetailDto, { ...detail, access: 'member', exactPlace, checkIn })).toBe(true);
    expect(
      ok(lobbyDetailDto, { ...detail, access: 'member', exactPlace, checkIn: { ...checkIn, lat: 55.1 } }),
    ).toBe(false);
    const member = {
      applicationId: REQUEST_ID,
      user: card.host,
      checkedInAt: null,
      absent: false,
      status: 'approved',
    };
    const attendance = {
      lobby: card,
      state: 'open',
      opensAt: card.endsAt,
      deadline: card.endsAt,
      members: [member],
    };
    expect(ok(attendanceResponse, attendance)).toBe(true);
    expect(ok(attendanceResponse, { ...attendance, members: [{ ...member, userId: REQUEST_ID }] })).toBe(
      false,
    );
  });

  it('wraps cards in the list responses', () => {
    expect(
      ok(feedResponse, { items: [card], nextCursor: null, days: [{ date: '2026-10-18', count: 1 }] }),
    ).toBe(true);
    expect(ok(feedResponse, { items: [card], nextCursor: null, days: null, total: 1 })).toBe(false);
    expect(ok(mapResponse, { stations: [{ place: card.place, lobbies: [card] }], truncated: false })).toBe(
      true,
    );
    const bucket = { upcoming: [card], past: [] };
    expect(
      ok(myLobbiesResponse, {
        hosting: bucket,
        joined: bucket,
        counts: { hosted: 1, joined: 0 },
        attendanceDue: [],
      }),
    ).toBe(true);
  });

  it('describes error bodies by code', () => {
    const body = {
      statusCode: 429,
      code: 'daily_limit',
      message: 'Лимит',
      retryAt: '2026-10-17T15:40:00.000Z',
    };
    expect(ok(apiErrorDto, body)).toBe(true);
    expect(ok(apiErrorDto, { ...body, code: 'teapot' })).toBe(false);
    expect(
      ok(apiErrorDto, { statusCode: 500, code: 'internal_error', message: 'Внутренняя ошибка сервера' }),
    ).toBe(true);
    expect(API_ERROR_CODES).toHaveLength(new Set(API_ERROR_CODES).size);
  });
});

describe('stage 4 inputs', () => {
  it('reportInput takes a known reason and an optional comment up to 300 characters', () => {
    expect(reportInput.parse({ reason: 'scam' })).toEqual({ reason: 'scam', comment: null });
    expect(reportInput.parse({ reason: 'promo', comment: '  \n ' })).toEqual({
      reason: 'promo',
      comment: null,
    });
    expect(reportInput.parse({ reason: 'other', comment: 'Бронь\nпереводом' }).comment).toBe(
      'Бронь\nпереводом',
    );
    expect(reportInput.safeParse({ reason: 'spam' }).success).toBe(false);
    expect(reportInput.safeParse({ reason: 'abuse', comment: 'я'.repeat(301) }).success).toBe(false);
    expect(reportInput.safeParse({ reason: 'abuse', comment: 'я'.repeat(300) }).success).toBe(true);
  });

  it('appealInput needs 20 to 1000 visible characters', () => {
    expect(appealInput.safeParse({ text: 'Клуб отменил бронь.' }).success).toBe(false);
    expect(appealInput.safeParse({ text: 'Клуб отменил бронь корта' }).success).toBe(true);
    expect(appealInput.safeParse({ text: `${'\u200b'.repeat(30)}коротко` }).success).toBe(false);
    expect(appealInput.safeParse({ text: 'а'.repeat(1001) }).success).toBe(false);
    expect(appealInput.parse({ text: '  Клуб отменил бронь корта  ' }).text).toBe('Клуб отменил бронь корта');
  });

  it('resolveCaseInput defaults the options and needs a reason to reject an appeal', () => {
    expect(resolveCaseInput.parse({ decision: 'reports_confirmed' })).toEqual({
      decision: 'reports_confirmed',
      comment: null,
      cancelUpcoming: true,
      blockCreation: false,
      refundKarma: false,
    });
    expect(resolveCaseInput.safeParse({ decision: 'appeal_rejected' }).success).toBe(false);
    expect(resolveCaseInput.safeParse({ decision: 'appeal_rejected', comment: '   ' }).success).toBe(false);
    expect(
      resolveCaseInput.safeParse({ decision: 'appeal_rejected', comment: 'Не подтвердилось' }).success,
    ).toBe(true);
    expect(resolveCaseInput.safeParse({ decision: 'ban_forever' }).success).toBe(false);
  });

  it('every decision belongs to exactly one case kind', () => {
    const all = MODERATION_CASE_KINDS.flatMap((kind) => CASE_DECISIONS[kind]);
    expect([...all].sort()).toEqual([...MODERATION_DECISIONS].sort());
  });

  it('userActionInput bounds a manual karma change and needs a comment for it', () => {
    expect(userActionInput.parse({ action: 'shadow_ban' })).toEqual({
      action: 'shadow_ban',
      karmaDelta: null,
      comment: null,
    });
    const change = { action: 'karma_change', comment: 'Помог с организацией' };
    expect(userActionInput.safeParse({ ...change, karmaDelta: 50 }).success).toBe(true);
    expect(userActionInput.safeParse({ ...change, karmaDelta: -50 }).success).toBe(true);
    expect(userActionInput.safeParse({ ...change, karmaDelta: 51 }).success).toBe(false);
    expect(userActionInput.safeParse({ ...change, karmaDelta: 0 }).success).toBe(false);
    expect(userActionInput.safeParse({ ...change, karmaDelta: 2.5 }).success).toBe(false);
    expect(userActionInput.safeParse({ action: 'karma_change', karmaDelta: 5 }).success).toBe(false);
    expect(userActionInput.safeParse({ ...change }).success).toBe(false);
    expect(userActionInput.safeParse({ action: 'cancel_lobby' }).success).toBe(false);
  });

  it('adminUserSearchQuery needs at least 2 visible characters', () => {
    expect(adminUserSearchQuery.safeParse({ q: 'о' }).success).toBe(false);
    expect(adminUserSearchQuery.parse({ q: ' @oleg ' })).toEqual({ q: '@oleg' });
    expect(adminUserSearchQuery.safeParse({}).success).toBe(false);
  });
});

describe('stage 4 responses fail closed', () => {
  const lobby = {
    id: REQUEST_ID,
    title: 'Бизнес-завтрак',
    description: null,
    category: 'networking',
    startsAt: '2026-10-19T07:00:00.000Z',
    endsAt: '2026-10-19T09:00:00.000Z',
    status: 'open',
    placeHint: 'м. Белорусская',
    slots: 10,
    approvedCount: 4,
    cancelReason: null,
    cancelledAt: null,
    attendanceSavedAt: null,
    hostedDelta: null,
    members: [],
  };

  it('adminLobbyDto has no exact place', () => {
    expect(ok(adminLobbyDto, lobby)).toBe(true);
    expect(ok(adminLobbyDto, { ...lobby, address: 'CANARY-ул. Тестовая, 1' })).toBe(false);
    expect(
      ok(adminLobbyDto, { ...lobby, exactPlace: { address: 'x', point: { lat: 55.7, lng: 37.6 } } }),
    ).toBe(false);
    expect(ok(adminLobbyDto, { ...lobby, cancelReason: 'moderation' })).toBe(true);
  });

  it('appealStateDto and adminCaseDto stay strict', () => {
    const state = { block: null, appeal: null, retryAt: null, canAppeal: false };
    expect(ok(appealStateDto, state)).toBe(true);
    expect(ok(appealStateDto, { ...state, moderatorId: REQUEST_ID })).toBe(false);
    expect(adminCaseDto.shape.lobby.unwrap().shape).not.toHaveProperty('address');
    expect(adminCaseDto.shape.lobby.unwrap().shape).not.toHaveProperty('location');
  });
});
