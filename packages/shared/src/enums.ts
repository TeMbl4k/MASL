/** User gender (onboarding). */
export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Lobby categories. They match interest slugs so the "For you" feed
 * can compare a lobby's category with the user's interests.
 */
export const LOBBY_CATEGORIES = [
  'sport',
  'boardgames',
  'bars',
  'food',
  'networking',
  'videogames',
  'cinema',
  'music',
  'walks',
  'culture',
  'other',
] as const;
export type LobbyCategory = (typeof LOBBY_CATEGORIES)[number];

/**
 * Lobby statuses (state machine):
 * open (gathering) → active (in progress) → finished; open/active → cancelled.
 */
export const LOBBY_STATUSES = ['open', 'active', 'finished', 'cancelled'] as const;
export type LobbyStatus = (typeof LOBBY_STATUSES)[number];

/** How a meetup is paid for. */
export const PAYMENT_FORMATS = ['free', 'split'] as const;
export type PaymentFormat = (typeof PAYMENT_FORMATS)[number];

/**
 * Status of a participant's request to join a lobby.
 * pending → approved | rejected; approved → cancelled | attended | no_show.
 */
export const MEMBERSHIP_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'attended',
  'no_show',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Karma change reasons (karma_events log). */
export const KARMA_REASONS = ['attended', 'late_cancel', 'no_show', 'host_late_cancel', 'manual'] as const;
export type KarmaReason = (typeof KARMA_REASONS)[number];
