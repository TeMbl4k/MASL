import { z } from 'zod';
import {
  AGE_MAX,
  AGE_MIN,
  APPEAL_TEXT_MAX,
  APPEAL_TEXT_MIN,
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
  MODERATION_COMMENT_MAX,
  MODERATION_KARMA_DELTA_MAX,
  MOSCOW_BOUNDS,
  PLACE_QUERY_MAX,
  PLACE_QUERY_MIN,
  REPORT_COMMENT_MAX,
  USER_SEARCH_MAX,
  USER_SEARCH_MIN,
} from './constants.js';
import {
  API_ERROR_CODES,
  APPEAL_STATUSES,
  APPLY_BLOCK_REASONS,
  ATTENDANCE_STATES,
  CHAT_STATES,
  CREATE_BLOCK_REASONS,
  CREATION_BLOCK_KINDS,
  FEEDBACK_RATINGS,
  GENDERS,
  KARMA_REASONS,
  LOBBY_CANCEL_REASONS,
  LOBBY_CANCEL_REASONS_OUT,
  LOBBY_CATEGORIES,
  LOBBY_STATUSES,
  MEMBERSHIP_STATUSES,
  MODERATION_ACTIONS,
  MODERATION_CASE_KINDS,
  MODERATION_CASE_STATUSES,
  MODERATION_DECISIONS,
  PAYMENT_FORMATS,
  REPORT_NOT_COUNTED,
  REPORT_REASONS,
  USER_MODERATION_ACTIONS,
  USER_ROLES,
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
/** Several lines with a minimum of visible characters. */
const boundedMultiLine = (min: number, max: number, messages: { tooShort: string; tooLong: string }) =>
  z
    .string()
    .transform(normalizeMultiLine)
    .pipe(
      z
        .string()
        .refine((value) => visibleLength(value) >= min, messages.tooShort)
        .max(max, messages.tooLong)
        .refine(noMarkFlood, MARK_FLOOD_MESSAGE),
    );
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
  /** The bot may message the user privately (exact address, approvals, attendance). */
  botCanWrite: z.boolean(),
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

/** POST /lobbies/:id/chat/prepare — `bot` sends the group picker as a button in the bot's chat. */
export const chatPrepareInput = z.object({ via: z.enum(['app', 'bot']).default('app') });
export type ChatPrepareInput = z.infer<typeof chatPrepareInput>;

/** POST /lobbies/:id/check-in — the device position, any point on Earth; never stored. */
export const checkInInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type CheckInInput = z.infer<typeof checkInInput>;

/** PUT /lobbies/:id/attendance — every other approved member counts as attended. */
export const attendanceInput = z.object({
  absentApplicationIds: z
    .array(z.uuid())
    .max(LOBBY_SLOTS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, 'Участники не должны повторяться'),
});
export type AttendanceInput = z.infer<typeof attendanceInput>;

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

// The places endpoints are POST: the typed address and the exact pin stay out of URLs,
// which access logs in front of the app record.

/** POST /places/suggest */
export const placeSuggestInput = z.object({ q: singleLine(PLACE_QUERY_MIN, PLACE_QUERY_MAX) });
export type PlaceSuggestInput = z.infer<typeof placeSuggestInput>;

/** POST /places/reverse — the exact pin; the server rounds it before calling DaData. */
export const placeReverseInput = z.object({ lat, lng });
export type PlaceReverseInput = z.infer<typeof placeReverseInput>;

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
  /** The viewer reported this lobby. */
  reported: z.boolean(),
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

/** The meetup group: for the host and approved members while the lobby is open or active. */
export const lobbyChatDto = z.strictObject({
  state: z.enum(CHAT_STATES),
  title: z.string().nullable(),
  inviteLink: z.string().nullable(),
});
export type LobbyChatDto = z.infer<typeof lobbyChatDto>;

/** Host, open lobby: from `lateFrom`, a cancel with every slot taken costs KARMA.HOST_LATE_CANCEL. */
export const cancelPolicyDto = z.strictObject({ lateFrom: isoOut, quorumMet: z.boolean() });
export type CancelPolicyDto = z.infer<typeof cancelPolicyDto>;

/** Approved member while the lobby is open or active: the «Я на месте» window. */
export const checkInDto = z.strictObject({
  opensAt: isoOut,
  closesAt: isoOut,
  checkedInAt: isoOut.nullable(),
});
export type CheckInDto = z.infer<typeof checkInDto>;

/** Host, finished lobby: where attendance marking stands. */
export const attendanceSummaryDto = z.strictObject({
  state: z.enum(ATTENDANCE_STATES),
  deadline: isoOut,
});
export type AttendanceSummaryDto = z.infer<typeof attendanceSummaryDto>;

const lobbyDetailBase = lobbyCardDto.extend({
  description: z.string().nullable(),
  cancelReason: z.enum(LOBBY_CANCEL_REASONS).nullable(),
  cancelComment: z.string().nullable(),
  /** Host, approved and attended members; null for everyone else (they see approvedCount). */
  members: z.array(personDto).nullable(),
  chat: lobbyChatDto.nullable(),
  cancelPolicy: cancelPolicyDto.nullable(),
  checkIn: checkInDto.nullable(),
  attendance: attendanceSummaryDto.nullable(),
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
  /** Hosted lobbies whose members still wait for the host's attendance marks. */
  attendanceDue: z.array(z.uuid()),
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

/** POST /lobbies/:id/cancel */
export const cancelLobbyResponse = z.strictObject({
  lobby: lobbyDetailDto,
  /** KARMA.HOST_LATE_CANCEL for a late cancel of a full lobby, otherwise 0. */
  karmaDelta: z.number().int(),
});
export type CancelLobbyResponse = z.infer<typeof cancelLobbyResponse>;

/** POST /lobbies/:id/chat/prepare — the id for WebApp.requestChat; null when the bot sent the button. */
export const chatPrepareResponse = z.strictObject({
  /** For WebApp.requestChat (`via: 'app'`); null when the bot sent the button to its chat. */
  preparedButtonId: z.string().nullable(),
  /** The bot's private chat (https://t.me/<username>), where the `bot` button waits. */
  botLink: z.url(),
});
export type ChatPrepareResponse = z.infer<typeof chatPrepareResponse>;

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

export const attendanceMemberDto = z.strictObject({
  applicationId: z.uuid(),
  user: personDto,
  /** Checked-in members can't be marked absent. */
  checkedInAt: isoOut.nullable(),
  /** Before the save: the host's draft from the bot; after it: the result. */
  absent: z.boolean(),
  status: z.enum(MEMBERSHIP_STATUSES),
});
export type AttendanceMemberDto = z.infer<typeof attendanceMemberDto>;

/** GET and PUT /lobbies/:id/attendance (host only). */
export const attendanceResponse = z.strictObject({
  lobby: lobbyCardDto,
  state: z.enum(ATTENDANCE_STATES),
  opensAt: isoOut,
  deadline: isoOut,
  members: z.array(attendanceMemberDto),
});
export type AttendanceResponse = z.infer<typeof attendanceResponse>;

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

/** POST /places/suggest — `enabled` false without a DaData key, `degraded` when DaData failed. */
export const placeSuggestResponse = z.strictObject({
  enabled: z.boolean(),
  degraded: z.boolean(),
  items: z.array(placeSuggestionDto),
});
export type PlaceSuggestResponse = z.infer<typeof placeSuggestResponse>;

/** POST /places/reverse */
export const placeReverseResponse = z.strictObject({
  enabled: z.boolean(),
  degraded: z.boolean(),
  address: z.string().nullable(),
});
export type PlaceReverseResponse = z.infer<typeof placeReverseResponse>;

// Moderation: the user's side

/** POST /lobbies/:id/reports */
export const reportInput = z.object({
  reason: z.enum(REPORT_REASONS, { error: 'Выберите причину' }),
  comment: optionalText(multiLine(REPORT_COMMENT_MAX, `Комментарий — до ${REPORT_COMMENT_MAX} символов`)),
});
export type ReportInput = z.infer<typeof reportInput>;

/** POST /lobbies/:id/reports — the same answer on a repeat. */
export const reportResponse = z.strictObject({ reported: z.literal(true) });
export type ReportResponse = z.infer<typeof reportResponse>;

/** POST /me/appeals */
export const appealInput = z.object({
  text: boundedMultiLine(APPEAL_TEXT_MIN, APPEAL_TEXT_MAX, {
    tooShort: `Опишите ситуацию: от ${APPEAL_TEXT_MIN} символов`,
    tooLong: `Апелляция — до ${APPEAL_TEXT_MAX} символов`,
  }),
});
export type AppealInput = z.infer<typeof appealInput>;

const lobbyRef = z.strictObject({ id: z.uuid(), title: z.string() });

/** Why the user can't create lobbies; their own data only. */
export const creationBlockDto = z.strictObject({
  kind: z.enum(CREATION_BLOCK_KINDS),
  since: isoOut,
  /** The lobby behind the block (a late cancel, a moderator's «сорвал»); null when there is none. */
  lobby: z.strictObject({ title: z.string(), startsAt: isoOut, cancelledAt: isoOut.nullable() }).nullable(),
  /** What the cause cost in karma on that lobby; null without one. */
  karmaDelta: z.number().int().nullable(),
});
export type CreationBlockDto = z.infer<typeof creationBlockDto>;

export const appealDto = z.strictObject({
  status: z.enum(APPEAL_STATUSES),
  createdAt: isoOut,
  decidedAt: isoOut.nullable(),
  /** The moderator's reason; rejections only. */
  comment: z.string().nullable(),
});
export type AppealDto = z.infer<typeof appealDto>;

/** GET /me/appeal and POST /me/appeals */
export const appealStateDto = z.strictObject({
  block: creationBlockDto.nullable(),
  /** The latest appeal, whatever its outcome. */
  appeal: appealDto.nullable(),
  /** After a rejection: no new appeal before this moment. */
  retryAt: isoOut.nullable(),
  canAppeal: z.boolean(),
});
export type AppealStateDto = z.infer<typeof appealStateDto>;

// Moderation: moderators and admins. No exact address or point anywhere below (rule 13).

const userRef = z.strictObject({ id: z.uuid(), firstName: z.string() });

/** A user as moderators see them. */
export const adminUserDto = z.strictObject({
  id: z.uuid(),
  telegramId: z.number().int(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  username: z.string().nullable(),
  photoUrl: z.string().nullable(),
  karma: z.number().int(),
  role: z.enum(USER_ROLES),
  isShadowBanned: z.boolean(),
  creationBlock: z.enum(CREATION_BLOCK_KINDS).nullable(),
  onboarded: z.boolean(),
  /** Account creation. */
  joinedAt: isoOut,
});
export type AdminUserDto = z.infer<typeof adminUserDto>;

const ratingCounts = z.strictObject({
  good: z.number().int(),
  bad: z.number().int(),
  notHeld: z.number().int(),
});

export const adminUserStatsDto = z.strictObject({
  /** Hosted lobbies that are not cancelled. */
  hosted: z.number().int(),
  attended: z.number().int(),
  noShows: z.number().int(),
  /** A participant's late cancels. */
  lateCancels: z.number().int(),
  /** A host's late cancels of a full lobby. */
  hostLateCancels: z.number().int(),
  reportsReceived: z.number().int(),
  /** Members' answers about the meetups the user hosted. */
  feedback: ratingCounts,
});
export type AdminUserStatsDto = z.infer<typeof adminUserStatsDto>;

export const adminReportDto = z.strictObject({
  id: z.uuid(),
  createdAt: isoOut,
  reason: z.enum(REPORT_REASONS),
  comment: z.string().nullable(),
  /** Null: the report counts toward the shadow ban. */
  notCounted: z.enum(REPORT_NOT_COUNTED).nullable(),
  reporter: z.strictObject({
    id: z.uuid(),
    firstName: z.string(),
    karma: z.number().int(),
    joinedAt: isoOut,
  }),
  lobby: lobbyRef,
});
export type AdminReportDto = z.infer<typeof adminReportDto>;

export const adminMemberDto = z.strictObject({
  user: z.strictObject({ id: z.uuid(), firstName: z.string(), karma: z.number().int() }),
  status: z.enum(MEMBERSHIP_STATUSES),
  checkedInAt: isoOut.nullable(),
  feedback: z.enum(FEEDBACK_RATINGS).nullable(),
  /** The member's attended/no_show karma on this lobby. */
  karmaDelta: z.number().int().nullable(),
});
export type AdminMemberDto = z.infer<typeof adminMemberDto>;

/** A lobby as moderators see it: the station hint, never the exact place. */
export const adminLobbyDto = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.enum(LOBBY_CATEGORIES),
  startsAt: isoOut,
  endsAt: isoOut,
  /** Effective status at read time. */
  status: z.enum(LOBBY_STATUSES),
  placeHint: z.string(),
  slots: z.number().int(),
  approvedCount: z.number().int(),
  cancelReason: z.enum(LOBBY_CANCEL_REASONS_OUT).nullable(),
  cancelledAt: isoOut.nullable(),
  attendanceSavedAt: isoOut.nullable(),
  /** The host's `hosted` karma for this lobby. */
  hostedDelta: z.number().int().nullable(),
  /** Everyone who was approved, with marks and feedback. */
  members: z.array(adminMemberDto),
});
export type AdminLobbyDto = z.infer<typeof adminLobbyDto>;

/** A queue row. */
export const adminCaseSummaryDto = z.strictObject({
  id: z.uuid(),
  kind: z.enum(MODERATION_CASE_KINDS),
  openedAt: isoOut,
  subject: z.strictObject({ id: z.uuid(), firstName: z.string(), karma: z.number().int() }),
  /** Reports: when the automatic shadow ban came. */
  shadowBannedAt: isoOut.nullable(),
  /** The case's lobby (not_held), or the latest reported one. */
  lobby: lobbyRef.nullable(),
  reports: z
    .strictObject({
      total: z.number().int(),
      counted: z.number().int(),
      reasons: z.array(z.enum(REPORT_REASONS)),
    })
    .nullable(),
  /** not_held: «Не состоялась» answers on the lobby. */
  notHeld: z.number().int().nullable(),
  /** appeal: what the user appeals against. */
  blockKind: z.enum(CREATION_BLOCK_KINDS).nullable(),
});
export type AdminCaseSummaryDto = z.infer<typeof adminCaseSummaryDto>;

/** GET /admin/cases */
export const adminCasesQuery = z.object({
  kind: optionalQuery(z.enum(MODERATION_CASE_KINDS)),
  cursor: optionalQuery(z.string().max(256)),
});
export type AdminCasesQuery = z.infer<typeof adminCasesQuery>;

/** GET /admin/cases — shadow-banned report cases first, then the oldest. */
export const adminCasesResponse = z.strictObject({
  items: z.array(adminCaseSummaryDto),
  nextCursor: z.string().nullable(),
  /** Open cases per kind, whatever the filter. */
  counts: z.strictObject({
    all: z.number().int(),
    reports: z.number().int(),
    not_held: z.number().int(),
    appeal: z.number().int(),
  }),
});
export type AdminCasesResponse = z.infer<typeof adminCasesResponse>;

/** GET /admin/cases/:id and the decision's answer. */
export const adminCaseDto = z.strictObject({
  id: z.uuid(),
  kind: z.enum(MODERATION_CASE_KINDS),
  status: z.enum(MODERATION_CASE_STATUSES),
  openedAt: isoOut,
  resolvedAt: isoOut.nullable(),
  decision: z.enum(MODERATION_DECISIONS).nullable(),
  decisionComment: z.string().nullable(),
  resolvedBy: userRef.nullable(),
  subject: adminUserDto,
  stats: adminUserStatsDto,
  shadowBannedAt: isoOut.nullable(),
  /** Reports of the case, newest first; empty for other kinds. */
  reports: z.array(adminReportDto),
  /** not_held: the lobby; appeal: the lobby behind the block; reports: the latest reported. */
  lobby: adminLobbyDto.nullable(),
  appealText: z.string().nullable(),
  /** The subject's current creation block. */
  block: creationBlockDto.nullable(),
  /** The subject's open lobbies that have not started: «Отменить предстоящие встречи». */
  upcomingLobbies: z.number().int(),
  /** appeal: karma «Вернуть карму» would give back; 0 when nothing. */
  refund: z.number().int(),
  /** The viewer is the subject: decisions are refused. */
  isSelf: z.boolean(),
});
export type AdminCaseDto = z.infer<typeof adminCaseDto>;

/** POST /admin/cases/:id/resolve — the decision must fit the case kind (CASE_DECISIONS). */
export const resolveCaseInput = z
  .object({
    decision: z.enum(MODERATION_DECISIONS),
    comment: optionalText(
      multiLine(MODERATION_COMMENT_MAX, `Комментарий — до ${MODERATION_COMMENT_MAX} символов`),
    ),
    /** reports_confirmed: cancel the subject's upcoming lobbies. */
    cancelUpcoming: z.boolean().default(true),
    /** reports_confirmed: also block lobby creation. */
    blockCreation: z.boolean().default(false),
    /** appeal_approved: give back the karma the block's cause cost. */
    refundKarma: z.boolean().default(false),
  })
  .refine((input) => input.decision !== 'appeal_rejected' || input.comment !== null, {
    path: ['comment'],
    error: 'Напишите причину отказа: её увидит пользователь',
  });
export type ResolveCaseInput = z.infer<typeof resolveCaseInput>;
export type ResolveCaseRequest = z.input<typeof resolveCaseInput>;

/** GET /admin/users — by @username, first or last name prefix, or an exact Telegram id. */
export const adminUserSearchQuery = z.object({
  q: singleLine(USER_SEARCH_MIN, USER_SEARCH_MAX, {
    tooShort: `Введите от ${USER_SEARCH_MIN} символов`,
    tooLong: `Не больше ${USER_SEARCH_MAX} символов`,
  }),
});
export type AdminUserSearchQuery = z.infer<typeof adminUserSearchQuery>;

export const adminUserSearchResponse = z.strictObject({ items: z.array(adminUserDto) });
export type AdminUserSearchResponse = z.infer<typeof adminUserSearchResponse>;

/** One entry of the moderation log; `actor` null is the system (automatic shadow ban). */
export const moderationLogEntryDto = z.strictObject({
  id: z.number().int(),
  createdAt: isoOut,
  action: z.enum(MODERATION_ACTIONS),
  actor: userRef.nullable(),
  karmaDelta: z.number().int().nullable(),
  comment: z.string().nullable(),
  /** resolve_case: the decision taken. */
  decision: z.enum(MODERATION_DECISIONS).nullable(),
  caseId: z.uuid().nullable(),
  lobby: lobbyRef.nullable(),
});
export type ModerationLogEntryDto = z.infer<typeof moderationLogEntryDto>;

/** GET /admin/users/:id and every user action. */
export const adminUserCardDto = z.strictObject({
  user: adminUserDto,
  stats: adminUserStatsDto,
  block: creationBlockDto.nullable(),
  openCases: z.array(z.strictObject({ id: z.uuid(), kind: z.enum(MODERATION_CASE_KINDS), openedAt: isoOut })),
  /** Newest first. */
  history: z.array(moderationLogEntryDto),
  isSelf: z.boolean(),
  /** The viewer is an admin and may appoint moderators. */
  viewerIsAdmin: z.boolean(),
});
export type AdminUserCardDto = z.infer<typeof adminUserCardDto>;

/** POST /admin/users/:id/actions — `karma_change` needs a delta and a comment. */
export const userActionInput = z
  .object({
    action: z.enum(USER_MODERATION_ACTIONS),
    karmaDelta: z
      .number()
      .int()
      .min(-MODERATION_KARMA_DELTA_MAX)
      .max(MODERATION_KARMA_DELTA_MAX)
      .refine((delta) => delta !== 0, 'Изменение не может быть нулевым')
      .nullish()
      .transform((value) => value ?? null),
    comment: optionalText(
      multiLine(MODERATION_COMMENT_MAX, `Комментарий — до ${MODERATION_COMMENT_MAX} символов`),
    ),
  })
  .refine((input) => input.action !== 'karma_change' || input.karmaDelta !== null, {
    path: ['karmaDelta'],
    error: `Укажите изменение кармы: от 1 до ${MODERATION_KARMA_DELTA_MAX} в любую сторону`,
  })
  .refine((input) => input.action !== 'karma_change' || input.comment !== null, {
    path: ['comment'],
    error: 'Напишите, за что меняется карма: пользователь это увидит',
  });
export type UserActionInput = z.infer<typeof userActionInput>;
export type UserActionRequest = z.input<typeof userActionInput>;

/** POST /admin/lobbies/:id/cancel — the comment goes to the log only. */
export const adminCancelLobbyInput = z.object({
  comment: optionalText(
    multiLine(MODERATION_COMMENT_MAX, `Комментарий — до ${MODERATION_COMMENT_MAX} символов`),
  ),
});
export type AdminCancelLobbyInput = z.infer<typeof adminCancelLobbyInput>;

export const adminCancelLobbyResponse = z.strictObject({ lobby: adminLobbyDto });
export type AdminCancelLobbyResponse = z.infer<typeof adminCancelLobbyResponse>;

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
