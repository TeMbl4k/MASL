/**
 * Product constants from the concept docs (code_artifact.md, gemini-code-*.md).
 * Values missing from the spec don't go here until product decides on them.
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
} as const;

/** Late-cancel window for participants, in hours before the start. */
export const LATE_CANCEL_WINDOW_HOURS = 2;
/** Hours before the start to check the quorum and offer the host to lower the minimum or cancel. */
export const QUORUM_CHECK_HOURS_BEFORE = 1;
/** A host cancelling later than this (not due to a missing quorum) counts as a host flake. */
export const HOST_LATE_CANCEL_HOURS = 1;
/** Hours after the end when the bot asks the host who showed up. */
export const ATTENDANCE_POLL_HOURS_AFTER = 2;
/** Daily lobby creation limit for new users. */
export const NEWBIE_LOBBIES_PER_DAY = 1;
/** Independent reports that trigger a shadow ban pending review. */
export const SHADOW_BAN_REPORTS = 3;

/** How many interest tags a user picks during onboarding. */
export const INTERESTS_MIN = 3;
export const INTERESTS_MAX = 5;

/** Allowed age at onboarding (bars and adult meetups: 18+). */
export const AGE_MIN = 18;
export const AGE_MAX = 99;

/** Lobby field limits. */
export const LOBBY_TITLE_MAX = 80;
export const LOBBY_DESCRIPTION_MAX = 1000;
export const LOBBY_SLOTS_MIN = 1;
export const LOBBY_SLOTS_MAX = 50;
