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
  /** A moderator's decision on a lobby: a host flake, a member's no-show taken back. */
  'moderation',
  /** Karma given back on an approved appeal; once per user and lobby. */
  'appeal_refund',
] as const;
export type KarmaReason = (typeof KARMA_REASONS)[number];

/** Statuses that take a lobby slot. */
export const OCCUPYING_MEMBERSHIP_STATUSES = [
  'approved',
  'attended',
  'no_show',
] as const satisfies readonly MembershipStatus[];
export type OccupyingMembershipStatus = (typeof OCCUPYING_MEMBERSHIP_STATUSES)[number];

/** Members who may rate a meetup: those who took part, by the host's marks so far. */
export const FEEDBACK_MEMBERSHIP_STATUSES = [
  'approved',
  'attended',
] as const satisfies readonly MembershipStatus[];

/** Kind of a station in the metro dataset: metro line or the Moscow Central Circle. */
export const METRO_KINDS = ['metro', 'mcc'] as const;
export type MetroKind = (typeof METRO_KINDS)[number];

/** Why the host cancelled a lobby (lobbies.cancel_reason). */
export const LOBBY_CANCEL_REASONS = ['not_enough_people', 'plans_changed', 'other'] as const;
export type LobbyCancelReason = (typeof LOBBY_CANCEL_REASONS)[number];

/** Stored cancel reasons: the host's, plus `moderation` for a moderator's cancel. */
export const LOBBY_CANCEL_REASONS_OUT = [...LOBBY_CANCEL_REASONS, 'moderation'] as const;
export type LobbyCancelReasonOut = (typeof LOBBY_CANCEL_REASONS_OUT)[number];

/** Shown in the app and in the bot's messages. */
export const LOBBY_CANCEL_REASON_LABELS: Readonly<Record<LobbyCancelReasonOut, string>> = {
  not_enough_people: 'Не набрались участники',
  plans_changed: 'Изменились планы',
  other: 'Другое',
  moderation: 'Отменена модерацией',
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
  'moderator_new_case',
  'user_appeal_approved',
  'user_appeal_rejected',
  'group_welcome',
  'group_finished',
  'group_cancelled',
  'group_kick',
  'group_leave',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** A member's answer to «Как прошла встреча?»; `not_held` opens a moderation case. */
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
  'report_own_lobby',
  'reports_daily_limit',
  'not_blocked',
  'appeal_open',
  'appeal_too_soon',
  'forbidden_moderation',
  'case_not_found',
  'case_resolved',
  'decision_mismatch',
  'user_not_found',
  'self_moderation',
  'admin_only',
  'rate_limited',
  'conflict',
  'invalid_data',
  'retry',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Why a lobby is reported. */
export const REPORT_REASONS = ['promo', 'scam', 'abuse', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Readonly<Record<ReportReason, string>> = {
  promo: 'Реклама или промо',
  scam: 'Мошенничество',
  abuse: 'Оскорбления или опасность',
  other: 'Другое',
};

/** Why a report doesn't count toward the shadow ban; shown to moderators only. */
export const REPORT_NOT_COUNTED = ['not_onboarded', 'shadow_banned', 'new_account', 'same_reporter'] as const;
export type ReportNotCounted = (typeof REPORT_NOT_COUNTED)[number];

/** What a moderation case is about: reports on a host, a «Не состоялась» answer, an appeal. */
export const MODERATION_CASE_KINDS = ['reports', 'not_held', 'appeal'] as const;
export type ModerationCaseKind = (typeof MODERATION_CASE_KINDS)[number];

export const MODERATION_CASE_STATUSES = ['open', 'resolved'] as const;
export type ModerationCaseStatus = (typeof MODERATION_CASE_STATUSES)[number];

export const MODERATION_DECISIONS = [
  'reports_dismissed',
  'reports_confirmed',
  'meetup_held',
  'host_flaked',
  'appeal_approved',
  'appeal_rejected',
] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

/** The decisions that close a case of each kind. */
export const CASE_DECISIONS: Readonly<Record<ModerationCaseKind, readonly ModerationDecision[]>> = {
  reports: ['reports_confirmed', 'reports_dismissed'],
  not_held: ['meetup_held', 'host_flaked'],
  appeal: ['appeal_approved', 'appeal_rejected'],
};

/** Entries of the moderation log; `auto_shadow_ban` has no actor. */
export const MODERATION_ACTIONS = [
  'auto_shadow_ban',
  'shadow_ban',
  'lift_shadow_ban',
  'block_creation',
  'unblock_creation',
  'karma_change',
  'cancel_lobby',
  'grant_moderator',
  'revoke_moderator',
  'resolve_case',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** What a moderator can do from a user card. */
export const USER_MODERATION_ACTIONS = [
  'shadow_ban',
  'lift_shadow_ban',
  'block_creation',
  'unblock_creation',
  'karma_change',
  'grant_moderator',
  'revoke_moderator',
] as const satisfies readonly ModerationAction[];
export type UserModerationAction = (typeof USER_MODERATION_ACTIONS)[number];

/** Only admins appoint and dismiss moderators. */
export const ADMIN_ONLY_ACTIONS: readonly UserModerationAction[] = ['grant_moderator', 'revoke_moderator'];

/** Why lobby creation is blocked: a host flake (stage 3) or a moderator's decision. */
export const CREATION_BLOCK_KINDS = ['late_cancel', 'moderation'] as const;
export type CreationBlockKind = (typeof CREATION_BLOCK_KINDS)[number];

/** Admin = Telegram id in ADMIN_TELEGRAM_IDS; moderator = users.is_moderator. */
export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Where the user's latest appeal stands. */
export const APPEAL_STATUSES = ['open', 'approved', 'rejected'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];
