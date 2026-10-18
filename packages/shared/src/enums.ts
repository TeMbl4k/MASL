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
 * open (gathering) → active (in progress) → finished; cancelled only from open (before the start).
 * The stored status is a cache of effectiveLobbyStatus(), except cancelled, which is authoritative.
 */
export const LOBBY_STATUSES = ['open', 'active', 'finished', 'cancelled'] as const;
export type LobbyStatus = (typeof LOBBY_STATUSES)[number];

/** How a meetup is paid for. */
export const PAYMENT_FORMATS = ['free', 'split'] as const;
export type PaymentFormat = (typeof PAYMENT_FORMATS)[number];

/**
 * Status of a participant's request to join a lobby.
 * pending → approved | rejected | cancelled; approved → cancelled (before the start) | attended | no_show;
 * cancelled (from pending) → pending (re-apply). Cancelled with decided_at set means the member left.
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
export const KARMA_REASONS = [
  'attended',
  'late_cancel',
  'no_show',
  'host_late_cancel',
  'manual',
  'hosted',
] as const;
export type KarmaReason = (typeof KARMA_REASONS)[number];

/** Statuses that take a lobby slot. */
export const OCCUPYING_MEMBERSHIP_STATUSES = [
  'approved',
  'attended',
  'no_show',
] as const satisfies readonly MembershipStatus[];
export type OccupyingMembershipStatus = (typeof OCCUPYING_MEMBERSHIP_STATUSES)[number];

/** Kind of a station in the metro dataset: metro line or the Moscow Central Circle. */
export const METRO_KINDS = ['metro', 'mcc'] as const;
export type MetroKind = (typeof METRO_KINDS)[number];

/** Why the host cancelled a lobby (lobbies.cancel_reason). */
export const LOBBY_CANCEL_REASONS = ['not_enough_people', 'plans_changed', 'other'] as const;
export type LobbyCancelReason = (typeof LOBBY_CANCEL_REASONS)[number];

/** Shown in the app and in the bot's messages. */
export const LOBBY_CANCEL_REASON_LABELS: Readonly<Record<LobbyCancelReason, string>> = {
  not_enough_people: 'Не набрались участники',
  plans_changed: 'Изменились планы',
  other: 'Другое',
};

/** What the viewer of a lobby detail may see: only member and host get the exact place. */
export const LOBBY_ACCESS = ['public', 'member', 'host'] as const;
export type LobbyAccess = (typeof LOBBY_ACCESS)[number];

/** Why the viewer can't apply to a lobby, in check order (the first failing check wins). */
export const APPLY_BLOCK_REASONS = [
  'not_onboarded',
  'own',
  'not_open',
  'rejected',
  'left',
  'karma',
  'full',
  'pending_limit',
  'applications_daily_limit',
] as const;
export type ApplyBlockReason = (typeof APPLY_BLOCK_REASONS)[number];

/** Why the user can't create a lobby now, in priority order. */
export const CREATE_BLOCK_REASONS = ['not_onboarded', 'blocked', 'daily_limit', 'upcoming_limit'] as const;
export type CreateBlockReason = (typeof CREATE_BLOCK_REASONS)[number];

/** Bot messages queued in the notifications outbox; `group_*` go to the meetup group. */
export const NOTIFICATION_KINDS = [
  'host_new_applications',
  'host_member_left',
  'host_quorum_check',
  'host_attendance_poll',
  'host_attendance_reminder',
  'member_approved',
  'member_rejected',
  'member_lobby_cancelled',
  'member_chat_ready',
  'member_attendance_result',
  'member_feedback_request',
  'group_welcome',
  'group_finished',
  'group_cancelled',
  'group_kick',
  'group_leave',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** A member's answer to «Как прошла встреча?». Stored only, until stage 4. */
export const FEEDBACK_RATINGS = ['good', 'bad', 'not_held'] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

/** The meetup group as the lobby detail shows it. */
export const CHAT_STATES = ['none', 'linked'] as const;
export type ChatState = (typeof CHAT_STATES)[number];

/**
 * Attendance marking of a lobby: not_yet before the end, open in the marking window,
 * saved by the host, closed when the window ran out without a save.
 */
export const ATTENDANCE_STATES = ['not_yet', 'open', 'saved', 'closed'] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

/**
 * Machine-readable `code` of API error bodies; the Russian message is chosen by the API per code.
 * The last four are the exception filter's redacted unexpected errors: unique violation (409),
 * check violation (400), deadlock or serialization failure (409) and anything else (500).
 */
export const API_ERROR_CODES = [
  'not_onboarded',
  'creation_blocked',
  'daily_limit',
  'upcoming_limit',
  'starts_too_soon',
  'starts_too_far',
  'place_too_far',
  'lobby_not_found',
  'not_host',
  'lobby_cancelled',
  'lobby_closed',
  'lobby_started',
  'lobby_full',
  'karma_too_low',
  'own_lobby',
  'application_rejected',
  'application_left',
  'pending_limit',
  'applications_daily_limit',
  'application_not_found',
  'application_not_pending',
  'applicant_karma_too_low',
  'invalid_cursor',
  'chat_already_linked',
  'bot_unavailable',
  'check_in_not_open',
  'check_in_closed',
  'check_in_too_far',
  'attendance_not_open',
  'attendance_closed',
  'attendance_saved',
  'checked_in_member',
  'rate_limited',
  'conflict',
  'invalid_data',
  'retry',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
