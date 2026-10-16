/** Пол пользователя (онбординг). */
export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Категории лобби. Совпадают со slug интересов, чтобы лента «Для вас»
 * могла сравнивать категорию лобби с интересами пользователя.
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
 * Статусы лобби (state machine):
 * open (сбор) → active (идёт) → finished; из open/active → cancelled.
 */
export const LOBBY_STATUSES = ['open', 'active', 'finished', 'cancelled'] as const;
export type LobbyStatus = (typeof LOBBY_STATUSES)[number];

/** Финансовый формат встречи. */
export const PAYMENT_FORMATS = ['free', 'split'] as const;
export type PaymentFormat = (typeof PAYMENT_FORMATS)[number];

/**
 * Статус заявки участника в лобби.
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

/** Причины изменения кармы (журнал karma_events). */
export const KARMA_REASONS = ['attended', 'late_cancel', 'no_show', 'host_late_cancel', 'manual'] as const;
export type KarmaReason = (typeof KARMA_REASONS)[number];
