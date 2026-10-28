/**
 * Product constants from the concept docs (code_artifact.md, gemini-code-*.md).
 * Values missing from the spec go here only after the owner decides on them (see decisions.md).
 */

/** Karma (reliability score). */
export const KARMA = {
  /** Starting karma for a new user. */
  START: 50,
  /** Showed up to a meetup (geo check-in or host confirmation). */
  ATTENDED: 10,
  /** Cancelled less than LATE_CANCEL_WINDOW_HOURS before the start. */
  LATE_CANCEL: -15,
  /** Silent no-show. */
  NO_SHOW: -30,
  /** Hosted a meetup that at least one member attended (decisions.md, stage 3). */
  HOSTED: 10,
  /** Host cancelled less than HOST_LATE_CANCEL_HOURS before the start with every slot taken. */
  HOST_LATE_CANCEL: -30,
  /** Ceiling: positive changes are clamped so karma never exceeds it (decisions.md, stage 3). */
  MAX: 100,
} as const;

/** Late-cancel window for participants, in hours before the start. */
export const LATE_CANCEL_WINDOW_HOURS = 2;
/** Hours before the start to check the quorum and offer the host to lower the minimum or cancel. */
export const QUORUM_CHECK_HOURS_BEFORE = 1;
/** A host cancelling later than this (not due to a missing quorum) counts as a host flake. */
export const HOST_LATE_CANCEL_HOURS = 1;
/** Hours after the end when the bot asks the host who showed up. */
export const ATTENDANCE_POLL_HOURS_AFTER = 2;
/** Hours after the end when the bot reminds a host who hasn't marked attendance. */
export const ATTENDANCE_REMINDER_HOURS_AFTER = 24;
/** Hours after the end when attendance closes for good; the bot also leaves the meetup group then. */
export const ATTENDANCE_CLOSE_HOURS_AFTER = 48;
/** «Я на месте» opens this many minutes before the start and stays open until the end. */
export const CHECK_IN_OPENS_MINUTES_BEFORE = 30;
/** «Я на месте» needs the member within this distance of the exact point. */
export const CHECK_IN_RADIUS_M = 500;
/** New applications are collected for this long into one message to the host. */
export const HOST_APPLICATIONS_NOTIFY_DELAY_SECONDS = 60;
/** A «Создать чат встречи» request is valid for this long. */
export const CHAT_REQUEST_TTL_MINUTES = 30;
/** Daily lobby creation limit for new users. */
export const NEWBIE_LOBBIES_PER_DAY = 1;
/** Independent reports that trigger a shadow ban pending review. */
export const SHADOW_BAN_REPORTS = 3;

/** Moderation (stage 4). A report's optional comment. */
export const REPORT_COMMENT_MAX = 300;
/** Reports one user may send in a rolling day. */
export const REPORTS_PER_DAY_MAX = 10;
/** Rolling window of REPORTS_PER_DAY_MAX. */
export const REPORTS_WINDOW_HOURS = 24;
/** A report counts toward the shadow ban only from an account at least this old. */
export const REPORTER_MIN_ACCOUNT_AGE_HOURS = 24;
/** Appeal text bounds, in visible characters. */
export const APPEAL_TEXT_MIN = 20;
export const APPEAL_TEXT_MAX = 1000;
/** After a rejected appeal the next one is allowed this many days after the decision. */
export const APPEAL_RETRY_DAYS = 7;
/** A moderator's comment: the reason of a rejection, a note for the log. */
export const MODERATION_COMMENT_MAX = 500;
/** A manual karma change by a moderator, either way. */
export const MODERATION_KARMA_DELTA_MAX = 50;
/** Open cases per page of the queue; users per search answer. */
export const MODERATION_PAGE_SIZE = 30;
/** User search query bounds. */
export const USER_SEARCH_MIN = 2;
export const USER_SEARCH_MAX = 64;
/** Latest moderation log entries on a user card. */
export const MODERATION_HISTORY_LIMIT = 50;

/** How many interest tags a user picks during onboarding. */
export const INTERESTS_MIN = 3;
export const INTERESTS_MAX = 5;

/**
 * Version of the user agreement the app asks to accept. Raise it only for a material change:
 * everyone who accepted an older version is asked again on the next sign-in.
 */
export const TERMS_VERSION = 1;

/** Allowed age at onboarding (bars and adult meetups: 18+). */
export const AGE_MIN = 18;
export const AGE_MAX = 99;

/** Lobby field limits. */
export const LOBBY_TITLE_MAX = 80;
export const LOBBY_DESCRIPTION_MAX = 1000;
export const LOBBY_SLOTS_MIN = 1;
export const LOBBY_SLOTS_MAX = 50;

/** Time zone of the product; all user-facing dates and the `day` filter use it. */
export const APP_TIME_ZONE = 'Europe/Moscow';
/** Moscow + New Moscow + inner Moscow Oblast (lat/lng degrees). */
export const MOSCOW_BOUNDS = { south: 55.1, west: 36.8, north: 56.05, east: 38.0 } as const;
export const MOSCOW_CENTER = { lat: 55.7539, lng: 37.6208 } as const;

/** Lobby fields. */
export const LOBBY_TITLE_MIN = 3;
export const LOBBY_ADDRESS_MIN = 3;
export const LOBBY_ADDRESS_MAX = 200;
export const LOBBY_CANCEL_COMMENT_MAX = 200;
/** min_karma is inclusive: karma >= minKarma. */
export const LOBBY_MIN_KARMA_MAX = 100;
/** Wizard presets; spec examples «выше 40», «> 70». */
export const LOBBY_MIN_KARMA_PRESETS = [40, 50, 60, 70, 80] as const;
/** Spec example «+3». */
export const LOBBY_DEFAULT_SLOTS = 3;
/** Wizard chips for slots, next to the stepper. */
export const LOBBY_SLOTS_PRESETS = [1, 2, 3, 5, 10] as const;

/** Lobby time window. */
export const LOBBY_MIN_LEAD_MINUTES = 15;
export const LOBBY_MAX_DAYS_AHEAD = 30;
export const LOBBY_DURATION_MIN_MINUTES = 30;
export const LOBBY_DURATION_MAX_MINUTES = 720;
export const LOBBY_DURATION_STEP_MINUTES = 15;
export const LOBBY_DURATION_PRESETS_MINUTES = [60, 90, 120, 180, 240, 360] as const;
export const LOBBY_DURATION_DEFAULT_MINUTES = 120;
/** Wizard time picker granularity (the server only truncates to the minute). */
export const LOBBY_START_STEP_MINUTES = 5;

/** Approximate place (the nearest metro/MCC station): farther than this → farFromMetro = true. */
export const PLACE_FAR_FROM_METRO_M = 1500;
/** Farther than this from the station → lobby creation is rejected. */
export const PLACE_MAX_FROM_METRO_M = 5000;
export const DISTANCE_ROUND_M = 100;
export const VIEWER_COORD_DECIMALS = 3;

/** Antispam (NEWBIE_LOBBIES_PER_DAY is above). Rolling window of the lobby creation limits. */
export const LOBBY_CREATE_WINDOW_HOURS = 24;
/** A user with fewer attended meetups than this is a newbie. */
export const NEWBIE_ATTENDED_MIN = 1;
export const LOBBIES_PER_DAY_MAX = 3;
export const HOSTED_UPCOMING_MAX = 5;
export const APPLICATIONS_PENDING_MAX = 10;
export const APPLICATIONS_PER_DAY_MAX = 30;
/** Rolling window of APPLICATIONS_PER_DAY_MAX. */
export const APPLICATIONS_WINDOW_HOURS = 24;

/** Feed and map. */
export const FEED_PAGE_SIZE = 20;
export const FEED_PAGE_SIZE_MAX = 50;
export const FEED_DAY_STRIP_DAYS = 7;
/** Lobbies starting within this window get the "soon" bonus; the first such card is featured. */
export const FEED_SOON_HOURS = 48;
/** score = time + soon + distance + interest; locked lobbies form a lower tier. */
export const FEED_RANKING = {
  TIME_DECAY_HOURS: 24,
  DISTANCE_DECAY_M: 5000,
  WEIGHT_TIME: 1,
  WEIGHT_SOON: 1,
  WEIGHT_DISTANCE: 1,
  WEIGHT_INTEREST: 0.6,
} as const;
export const MAP_LOBBIES_MAX = 300;
export const MY_LOBBIES_PAST_LIMIT = 20;
export const KARMA_EVENTS_LIMIT = 20;

/** Address suggestions (DaData). */
export const PLACE_QUERY_MIN = 3;
export const PLACE_QUERY_MAX = 120;
export const PLACE_SUGGESTIONS_MAX = 5;
/** Below the free plan quota (about 10k requests a day). */
export const DADATA_DAILY_BUDGET = 8000;

/** Request rate limits per user, enforced by RateLimitGuard. */
export const RATE_LIMITS = {
  lobbyRead: { limit: 120, windowSeconds: 60 },
  lobbyWrite: { limit: 10, windowSeconds: 60 },
  applicationWrite: { limit: 20, windowSeconds: 60 },
  hostDecision: { limit: 60, windowSeconds: 60 },
  placeSuggest: { limit: 30, windowSeconds: 60 },
  placeSuggestDaily: { limit: 300, windowSeconds: 86_400 },
  placeReverse: { limit: 20, windowSeconds: 60 },
  checkIn: { limit: 10, windowSeconds: 60 },
  attendanceWrite: { limit: 20, windowSeconds: 60 },
  /** Taps on the bot's inline buttons. */
  botCallback: { limit: 30, windowSeconds: 60 },
  reportWrite: { limit: 10, windowSeconds: 60 },
  appealWrite: { limit: 5, windowSeconds: 60 },
  moderationRead: { limit: 120, windowSeconds: 60 },
  moderationWrite: { limit: 60, windowSeconds: 60 },
} as const;
export type RateLimitBucket = keyof typeof RATE_LIMITS;
