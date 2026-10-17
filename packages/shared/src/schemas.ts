import { z } from 'zod';
import {
  AGE_MAX,
  AGE_MIN,
  FEED_PAGE_SIZE,
  FEED_PAGE_SIZE_MAX,
  INTERESTS_MAX,
  INTERESTS_MIN,
  LOBBY_ADDRESS_MAX,
  LOBBY_ADDRESS_MIN,
  LOBBY_CANCEL_COMMENT_MAX,
  LOBBY_DESCRIPTION_MAX,
  LOBBY_DURATION_MAX_MINUTES,
  LOBBY_DURATION_MIN_MINUTES,
  LOBBY_DURATION_STEP_MINUTES,
  LOBBY_MIN_KARMA_MAX,
  LOBBY_SLOTS_MAX,
  LOBBY_SLOTS_MIN,
  LOBBY_TITLE_MAX,
  LOBBY_TITLE_MIN,
  MOSCOW_BOUNDS,
  PLACE_QUERY_MAX,
  PLACE_QUERY_MIN,
} from './constants.js';
import {
  API_ERROR_CODES,
  APPLY_BLOCK_REASONS,
  CREATE_BLOCK_REASONS,
  GENDERS,
  KARMA_REASONS,
  LOBBY_CANCEL_REASONS,
  LOBBY_CATEGORIES,
  LOBBY_STATUSES,
  MEMBERSHIP_STATUSES,
  PAYMENT_FORMATS,
} from './enums.js';
import { INTERESTS } from './interests.js';
import { OUTSIDE_MOSCOW_MESSAGE, roundViewerCoord } from './lobby-rules.js';
import { noMarkFlood, normalizeMultiLine, normalizeSingleLine, visibleLength } from './text.js';

// Plain objects are composed first and refined only at the leaves:
// zod 4 throws on .pick/.omit of an object with object-level refinements.

const interestSlug = z.enum(INTERESTS.map((i) => i.slug) as [string, ...string[]]);
const interestList = z
  .array(interestSlug)
  .min(INTERESTS_MIN)
  .max(INTERESTS_MAX)
  .refine((list) => new Set(list).size === list.length, 'Интересы не должны повторяться');

/** Input instant: an explicit offset (or Z) is required; a value without one gets 400. */
const isoInstant = z.iso.datetime({ offset: true });
/** Output instant: always Date#toISOString(). */
const isoOut = z.iso.datetime();
/**
 * Moscow calendar day 'YYYY-MM-DD'. The fixed year range needs no clock and keeps every accepted
 * day valid for PostgreSQL (no year 0) and for the time.ts helpers.
 */
const MOSCOW_DAY_MIN = '2000-01-01';
const MOSCOW_DAY_MAX = '2099-12-31';
const moscowDate = z.iso
  .date()
  .refine((day) => day >= MOSCOW_DAY_MIN && day <= MOSCOW_DAY_MAX, 'Некорректная дата');
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const MARK_FLOOD_MESSAGE = 'Слишком много диакритических знаков';

/** `?x=` arrives as ''; treat it as a missing parameter (z.coerce.number('') would be 0). */
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);
const optionalQuery = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());
const queryNum = (schema: z.ZodType<number, number>) => optionalQuery(z.coerce.number().pipe(schema));

/**
 * One line of user text, normalised before the length checks (text.ts). `min` counts visible
 * characters, so joiners and variation selectors can't pad a blank title.
 */
const singleLine = (min: number, max: number, messages: { tooShort?: string; tooLong?: string } = {}) =>
  z
    .string()
    .transform(normalizeSingleLine)
    .pipe(
      z
        .string()
        .refine((value) => visibleLength(value) >= min, messages.tooShort)
        .max(max, messages.tooLong)
        .refine(noMarkFlood, MARK_FLOOD_MESSAGE),
    );
/** Several lines of user text; keeps line breaks, at most two blank lines in a row. */
const multiLine = (max: number, tooLong?: string) =>
  z
    .string()
    .transform(normalizeMultiLine)
    .pipe(z.string().max(max, tooLong).refine(noMarkFlood, MARK_FLOOD_MESSAGE));
/** Optional text: missing, null and blank all become null. */
const optionalText = <T extends z.ZodType<string, string>>(schema: T) =>
  schema.nullish().transform((value) => value || null);

const lat = z
  .number()
  .min(MOSCOW_BOUNDS.south, OUTSIDE_MOSCOW_MESSAGE)
  .max(MOSCOW_BOUNDS.north, OUTSIDE_MOSCOW_MESSAGE);
const lng = z
  .number()
  .min(MOSCOW_BOUNDS.west, OUTSIDE_MOSCOW_MESSAGE)
  .max(MOSCOW_BOUNDS.east, OUTSIDE_MOSCOW_MESSAGE);

/** Viewer origin in a query: both coordinates or none, rounded on the server too. */
const originShape = {
  lat: queryNum(lat.transform(roundViewerCoord)),
  lng: queryNum(lng.transform(roundViewerCoord)),
};
const bothCoordsOrNone = (q: { lat?: number; lng?: number }) =>
  (q.lat === undefined) === (q.lng === undefined);
const BOTH_COORDS_ISSUE = { path: ['lat'], error: 'Нужны обе координаты' };

// Auth and profile

/** POST /auth/telegram — raw initData string from Telegram.WebApp. */
export const telegramAuthInput = z.object({
  initData: z.string().min(1).max(4096),
});
export type TelegramAuthInput = z.infer<typeof telegramAuthInput>;

/** PUT /me/onboarding — onboarding is a single step. */
export const onboardingInput = z.object({
  gender: z.enum(GENDERS),
  age: z.number().int().min(AGE_MIN).max(AGE_MAX),
  interests: interestList,
});
export type OnboardingInput = z.infer<typeof onboardingInput>;

/** Current user's profile as returned by the API. */
export const meDto = z.object({
  id: z.string().uuid(),
  telegramId: z.number().int(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  username: z.string().nullable(),
  photoUrl: z.string().nullable(),
  gender: z.enum(GENDERS).nullable(),
  age: z.number().int().nullable(),
  karma: z.number().int(),
  interests: z.array(z.string()),
  onboarded: z.boolean(),
});
export type MeDto = z.infer<typeof meDto>;

export const authResponse = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: meDto,
});
export type AuthResponse = z.infer<typeof authResponse>;

export const interestDto = z.object({
  slug: z.string(),
  title: z.string(),
  emoji: z.string(),
});
export type InterestDto = z.infer<typeof interestDto>;

/** PUT /me/interests — replaces the interests chosen at onboarding. */
export const updateInterestsInput = z.object({ interests: interestList });
export type UpdateInterestsInput = z.infer<typeof updateInterestsInput>;

// Lobby, application and place inputs

/** `:id` and `:applicationId` route params. */
export const idParam = z.uuid();

/** A point inside MOSCOW_BOUNDS. */
export const moscowPointInput = z.object({ lat, lng }, { error: 'Поставьте точку на карте' });
export type MoscowPointInput = z.infer<typeof moscowPointInput>;

/** GET /lobbies/:id — optional viewer origin for `distanceM`. */
export const originQuery = z.object(originShape).refine(bothCoordsOrNone, BOTH_COORDS_ISSUE);
export type OriginQuery = z.infer<typeof originQuery>;
export const lobbyDetailQuery = originQuery;
export type LobbyDetailQuery = OriginQuery;

/** Wizard step 1 «Суть». The wizard steps are the parts of createLobbyInput. */
export const lobbyEssenceInput = z.object({
  category: z.enum(LOBBY_CATEGORIES, { error: 'Выберите категорию' }),
  title: singleLine(LOBBY_TITLE_MIN, LOBBY_TITLE_MAX, {
    tooShort: `Название — от ${LOBBY_TITLE_MIN} символов`,
    tooLong: `Название — до ${LOBBY_TITLE_MAX} символов`,
  }),
  description: optionalText(
    multiLine(LOBBY_DESCRIPTION_MAX, `Описание — до ${LOBBY_DESCRIPTION_MAX} символов`),
  ),
});
export type LobbyEssenceInput = z.infer<typeof lobbyEssenceInput>;

/** Wizard step 2 «Время и место». The start window is checked by validateLobbyStart(startsAt, now). */
export const lobbyWhenWhereInput = z.object({
  startsAt: isoInstant,
  durationMinutes: z
    .number()
    .int()
    .min(LOBBY_DURATION_MIN_MINUTES)
    .max(LOBBY_DURATION_MAX_MINUTES)
    .multipleOf(LOBBY_DURATION_STEP_MINUTES),
  /** Exact point; the public place is derived from it on the server. */
  location: moscowPointInput,
  address: singleLine(LOBBY_ADDRESS_MIN, LOBBY_ADDRESS_MAX, {
    tooShort: 'Укажите адрес',
    tooLong: `Адрес — до ${LOBBY_ADDRESS_MAX} символов`,
  }),
});
export type LobbyWhenWhereInput = z.infer<typeof lobbyWhenWhereInput>;

/** Wizard step 3 «Условия». */
export const lobbyTermsInput = z.object({
  slots: z.number().int().min(LOBBY_SLOTS_MIN).max(LOBBY_SLOTS_MAX),
  minKarma: z.number().int().min(0).max(LOBBY_MIN_KARMA_MAX).nullable(),
  paymentFormat: z.enum(PAYMENT_FORMATS),
});
export type LobbyTermsInput = z.infer<typeof lobbyTermsInput>;

/** POST /lobbies — `requestId` is one per wizard draft and makes the publish idempotent. */
export const createLobbyInput = lobbyEssenceInput
  .extend(lobbyWhenWhereInput.shape)
  .extend(lobbyTermsInput.shape)
  .extend({ requestId: z.uuid() });
export type CreateLobbyInput = z.infer<typeof createLobbyInput>;

/** POST /lobbies/:id/cancel */
export const cancelLobbyInput = z.object({
  reason: z.enum(LOBBY_CANCEL_REASONS),
  comment: optionalText(singleLine(0, LOBBY_CANCEL_COMMENT_MAX)),
});
export type CancelLobbyInput = z.infer<typeof cancelLobbyInput>;

/** GET /lobbies/feed */
export const feedQuery = z
  .object({
    ...originShape,
    category: optionalQuery(z.enum(LOBBY_CATEGORIES)),
    day: optionalQuery(moscowDate),
    cursor: optionalQuery(z.string().max(512)),
    limit: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(FEED_PAGE_SIZE_MAX).default(FEED_PAGE_SIZE),
    ),
  })
  .refine(bothCoordsOrNone, BOTH_COORDS_ISSUE);
export type FeedQuery = z.infer<typeof feedQuery>;

/** GET /lobbies/map */
export const mapQuery = z.object({
  category: optionalQuery(z.enum(LOBBY_CATEGORIES)),
  day: optionalQuery(moscowDate),
});
export type MapQuery = z.infer<typeof mapQuery>;

/** GET /places/suggest */
export const placeSuggestQuery = z.object({ q: singleLine(PLACE_QUERY_MIN, PLACE_QUERY_MAX) });
export type PlaceSuggestQuery = z.infer<typeof placeSuggestQuery>;

/** GET /places/reverse — the exact pin, so it is not rounded. */
export const placeReverseQuery = z.object({
  lat: z.coerce.number().pipe(lat),
  lng: z.coerce.number().pipe(lng),
});
export type PlaceReverseQuery = z.infer<typeof placeReverseQuery>;

// Responses are strict objects: an unexpected field (an exact address) fails closed.

export const geoPointDto = z.strictObject({ lat: z.number(), lng: z.number() });
export type GeoPointDto = z.infer<typeof geoPointDto>;

/** Public data of a host or member; no user id, username or Telegram id. */
export const personDto = z.strictObject({
  firstName: z.string(),
  photoUrl: z.string().nullable(),
  karma: z.number().int(),
});
export type PersonDto = z.infer<typeof personDto>;

/** Approximate place: the nearest metro/MCC station. */
export const publicPlaceDto = z.strictObject({
  /** «м. Динамо», «МЦК Лужники». */
  hint: z.string(),
  stationId: z.string(),
  /** Null only if the station id left the dataset. */
  lineName: z.string().nullable(),
  lineColor: hexColor.nullable(),
  /** The station point, never the exact one. */
  point: geoPointDto,
  farFromMetro: z.boolean(),
});
export type PublicPlaceDto = z.infer<typeof publicPlaceDto>;

/** Exact place: only for the host and approved members while the lobby is open or active. */
export const exactPlaceDto = z.strictObject({ address: z.string(), point: geoPointDto });
export type ExactPlaceDto = z.infer<typeof exactPlaceDto>;

export const lobbyViewerDto = z.strictObject({
  isHost: z.boolean(),
  membershipStatus: z.enum(MEMBERSHIP_STATUSES).nullable(),
  /** First failing apply check; null when apply is allowed or would be an idempotent repeat. */
  applyBlock: z.enum(APPLY_BLOCK_REASONS).nullable(),
});
export type LobbyViewerDto = z.infer<typeof lobbyViewerDto>;

/** A lobby in the feed, on the map and in «Мои». */
export const lobbyCardDto = z.strictObject({
  id: z.uuid(),
  category: z.enum(LOBBY_CATEGORIES),
  title: z.string(),
  startsAt: isoOut,
  endsAt: isoOut,
  /** Effective status at read time. */
  status: z.enum(LOBBY_STATUSES),
  slots: z.number().int(),
  /** Members in occupying statuses (approved, attended, no_show). */
  approvedCount: z.number().int(),
  /** Host only. */
  pendingCount: z.number().int().nullable(),
  minKarma: z.number().int().nullable(),
  paymentFormat: z.enum(PAYMENT_FORMATS),
  place: publicPlaceDto,
  /** From the public point; null without an origin and always on the map. */
  distanceM: z.number().int().nullable(),
  host: personDto,
  viewer: lobbyViewerDto,
});
export type LobbyCardDto = z.infer<typeof lobbyCardDto>;

const lobbyDetailBase = lobbyCardDto.extend({
  description: z.string().nullable(),
  cancelReason: z.enum(LOBBY_CANCEL_REASONS).nullable(),
  cancelComment: z.string().nullable(),
  /** Host, approved and attended members; null for everyone else (they see approvedCount). */
  members: z.array(personDto).nullable(),
});

/** GET /lobbies/:id and every lobby mutation; only `member` and `host` carry the exact place. */
export const lobbyDetailDto = z.discriminatedUnion('access', [
  lobbyDetailBase.extend({ access: z.literal('public') }),
  lobbyDetailBase.extend({ access: z.literal('member'), exactPlace: exactPlaceDto }),
  lobbyDetailBase.extend({ access: z.literal('host'), exactPlace: exactPlaceDto }),
]);
export type LobbyDetailDto = z.infer<typeof lobbyDetailDto>;

export const feedDayDto = z.strictObject({ date: moscowDate, count: z.number().int() });
export type FeedDayDto = z.infer<typeof feedDayDto>;

/** GET /lobbies/feed */
export const feedResponse = z.strictObject({
  items: z.array(lobbyCardDto),
  nextCursor: z.string().nullable(),
  /** Lobby counts for the day strip; first page only. */
  days: z.array(feedDayDto).nullable(),
});
export type FeedResponse = z.infer<typeof feedResponse>;

export const mapStationDto = z.strictObject({ place: publicPlaceDto, lobbies: z.array(lobbyCardDto) });
export type MapStationDto = z.infer<typeof mapStationDto>;

/** GET /lobbies/map */
export const mapResponse = z.strictObject({
  stations: z.array(mapStationDto),
  /** More than MAP_LOBBIES_MAX lobbies matched; the earliest ones are shown. */
  truncated: z.boolean(),
});
export type MapResponse = z.infer<typeof mapResponse>;

export const lobbyBucketDto = z.strictObject({
  upcoming: z.array(lobbyCardDto),
  /** Finished and cancelled, newest first, capped at MY_LOBBIES_PAST_LIMIT. */
  past: z.array(lobbyCardDto),
});
export type LobbyBucketDto = z.infer<typeof lobbyBucketDto>;

/** GET /me/lobbies */
export const myLobbiesResponse = z.strictObject({
  hosting: lobbyBucketDto,
  joined: lobbyBucketDto,
  /** Profile numbers: hosted lobbies that are not cancelled, memberships in occupying statuses. */
  counts: z.strictObject({ hosted: z.number().int(), joined: z.number().int() }),
});
export type MyLobbiesResponse = z.infer<typeof myLobbiesResponse>;

/** GET /lobbies/creation-context */
export const creationContextDto = z.strictObject({
  canCreate: z.boolean(),
  reason: z.enum(CREATE_BLOCK_REASONS).nullable(),
  retryAt: isoOut.nullable(),
  isNewbie: z.boolean(),
  dailyLimit: z.number().int(),
  createdInWindow: z.number().int(),
  upcomingLimit: z.number().int(),
  upcomingCount: z.number().int(),
  /** DaData address suggestions are configured. */
  addressSuggest: z.boolean(),
});
export type CreationContextDto = z.infer<typeof creationContextDto>;

/** DELETE /lobbies/:id/applications/me */
export const cancelApplicationResponse = z.strictObject({
  lobby: lobbyDetailDto,
  /** KARMA.LATE_CANCEL for a late cancel of an approved place, otherwise 0. */
  karmaDelta: z.number().int(),
});
export type CancelApplicationResponse = z.infer<typeof cancelApplicationResponse>;

/** An application as the host sees it; no age or gender. */
export const applicantDto = z.strictObject({
  applicationId: z.uuid(),
  status: z.enum(MEMBERSHIP_STATUSES),
  appliedAt: isoOut,
  decidedAt: isoOut.nullable(),
  user: personDto.extend({ isNewbie: z.boolean() }),
  meetsMinKarma: z.boolean(),
});
export type ApplicantDto = z.infer<typeof applicantDto>;

/** GET /lobbies/:id/applications and the host's approve/reject. */
export const hostApplicationsResponse = z.strictObject({
  lobby: lobbyCardDto,
  pending: z.array(applicantDto),
  /** Approved, attended and no_show. */
  approved: z.array(applicantDto),
  rejected: z.array(applicantDto),
});
export type HostApplicationsResponse = z.infer<typeof hostApplicationsResponse>;

export const karmaEventDto = z.strictObject({
  reason: z.enum(KARMA_REASONS),
  delta: z.number().int(),
  createdAt: isoOut,
  lobby: z.strictObject({ id: z.uuid(), title: z.string() }).nullable(),
});
export type KarmaEventDto = z.infer<typeof karmaEventDto>;

/** GET /me/karma-events — newest first, KARMA_EVENTS_LIMIT items. */
export const karmaEventsResponse = z.strictObject({ items: z.array(karmaEventDto) });
export type KarmaEventsResponse = z.infer<typeof karmaEventsResponse>;

export const placeSuggestionDto = z.strictObject({ value: z.string(), point: geoPointDto.nullable() });
export type PlaceSuggestionDto = z.infer<typeof placeSuggestionDto>;

/** GET /places/suggest — `enabled` false without a DaData key, `degraded` when DaData failed. */
export const placeSuggestResponse = z.strictObject({
  enabled: z.boolean(),
  degraded: z.boolean(),
  items: z.array(placeSuggestionDto),
});
export type PlaceSuggestResponse = z.infer<typeof placeSuggestResponse>;

/** GET /places/reverse */
export const placeReverseResponse = z.strictObject({
  enabled: z.boolean(),
  degraded: z.boolean(),
  address: z.string().nullable(),
});
export type PlaceReverseResponse = z.infer<typeof placeReverseResponse>;

/**
 * Error body built by the API's apiError(), including the 409/400/500 bodies of the exception
 * filter (`conflict`, `invalid_data`, `retry`, `internal_error`). Without `code`: pipe validation
 * errors `{ message, issues }` and plain Nest HttpExceptions (the stage 1 core's 401/404/503,
 * unknown routes). Every body has a `message`, the only field the web reads.
 */
export const apiErrorDto = z.object({
  statusCode: z.number().int(),
  code: z.enum(API_ERROR_CODES),
  message: z.string(),
  retryAt: isoOut.optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiErrorDto = z.infer<typeof apiErrorDto>;
