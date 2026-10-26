import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  CASE_DECISIONS,
  CREATION_BLOCK_KINDS,
  FEEDBACK_RATINGS,
  GENDERS,
  KARMA,
  KARMA_REASONS,
  LOBBY_CANCEL_COMMENT_MAX,
  LOBBY_CATEGORIES,
  LOBBY_DESCRIPTION_MAX,
  LOBBY_MIN_KARMA_MAX,
  LOBBY_SLOTS_MAX,
  LOBBY_SLOTS_MIN,
  LOBBY_STATUSES,
  LOBBY_TITLE_MAX,
  MEMBERSHIP_STATUSES,
  MODERATION_ACTIONS,
  MODERATION_CASE_KINDS,
  MODERATION_COMMENT_MAX,
  MODERATION_DECISIONS,
  PAYMENT_FORMATS,
  REPORT_COMMENT_MAX,
  REPORT_REASONS,
  APPEAL_TEXT_MAX,
  type NotificationKind,
  type ReportNotCounted,
} from '@masl/shared';
import { geographyPoint } from './geo.js';

export const genderEnum = pgEnum('gender', GENDERS);
export const lobbyCategoryEnum = pgEnum('lobby_category', LOBBY_CATEGORIES);
export const lobbyStatusEnum = pgEnum('lobby_status', LOBBY_STATUSES);
export const paymentFormatEnum = pgEnum('payment_format', PAYMENT_FORMATS);
export const membershipStatusEnum = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const karmaReasonEnum = pgEnum('karma_reason', KARMA_REASONS);
export const feedbackRatingEnum = pgEnum('feedback_rating', FEEDBACK_RATINGS);
export const reportReasonEnum = pgEnum('report_reason', REPORT_REASONS);
export const creationBlockKindEnum = pgEnum('creation_block_kind', CREATION_BLOCK_KINDS);
export const moderationCaseKindEnum = pgEnum('moderation_case_kind', MODERATION_CASE_KINDS);
export const moderationDecisionEnum = pgEnum('moderation_decision', MODERATION_DECISIONS);
export const moderationActionEnum = pgEnum('moderation_action', MODERATION_ACTIONS);

/** `decision in ('a','b')` for the decisions of one case kind. */
const decisionsOf = (kind: keyof typeof CASE_DECISIONS) =>
  sql.raw(CASE_DECISIONS[kind].map((d) => `'${d}'`).join(','));

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Telegram user id (up to 52 bits, fits safely in a JS number). */
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
    firstName: varchar('first_name', { length: 128 }).notNull(),
    lastName: varchar('last_name', { length: 128 }),
    username: varchar('username', { length: 64 }),
    photoUrl: text('photo_url'),
    languageCode: varchar('language_code', { length: 16 }),
    /** Whether the user allowed the bot to message them privately (initData.user.allows_write_to_pm). */
    allowsWriteToPm: boolean('allows_write_to_pm').notNull().default(false),
    /** auth_date of the initData the profile came from; older initData doesn't overwrite it. */
    telegramAuthDate: timestamp('telegram_auth_date', { withTimezone: true }).notNull(),
    gender: genderEnum('gender'),
    /** Birth year rather than age, so the age never goes stale. */
    birthYear: smallint('birth_year'),
    /** Current karma = KARMA.START + sum of delta in karma_events. */
    karma: integer('karma').notNull().default(KARMA.START),
    /** Shadow ban pending moderator review (after 3 reports). */
    isShadowBanned: boolean('is_shadow_banned').notNull().default(false),
    /** Lobby creation blocked after a host flake or by a moderator; lifted on appeal. */
    lobbyCreationBlocked: boolean('lobby_creation_blocked').notNull().default(false),
    /** Why creation is blocked, when and over which lobby (null for a block without one). */
    creationBlockedReason: creationBlockKindEnum('creation_blocked_reason'),
    creationBlockedAt: timestamp('creation_blocked_at', { withTimezone: true }),
    creationBlockedLobbyId: uuid('creation_blocked_lobby_id').references((): AnyPgColumn => lobbies.id, {
      onDelete: 'set null',
    }),
    /** Appointed by an admin; admins themselves come from ADMIN_TELEGRAM_IDS. */
    isModerator: boolean('is_moderator').notNull().default(false),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_telegram_id_uq').on(t.telegramId),
    check(
      'users_creation_block_chk',
      sql`${t.lobbyCreationBlocked} = (${t.creationBlockedReason} is not null) and (${t.creationBlockedReason} is null) = (${t.creationBlockedAt} is null)`,
    ),
  ],
);

export const interests = pgTable('interests', {
  slug: varchar('slug', { length: 32 }).primaryKey(),
  title: varchar('title', { length: 64 }).notNull(),
  emoji: varchar('emoji', { length: 16 }).notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export const userInterests = pgTable(
  'user_interests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    interestSlug: varchar('interest_slug', { length: 32 })
      .notNull()
      .references(() => interests.slug, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.interestSlug] })],
);

export const lobbies = pgTable(
  'lobbies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    category: lobbyCategoryEnum('category').notNull(),
    title: varchar('title', { length: LOBBY_TITLE_MAX }).notNull(),
    description: varchar('description', { length: LOBBY_DESCRIPTION_MAX }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Exact location. Exposed only to the host and approved members. */
    location: geographyPoint('location').notNull(),
    address: text('address').notNull(),
    /** Public approximate place for the feed and lobby card, e.g. "м. Динамо". */
    placeHint: varchar('place_hint', { length: 128 }).notNull(),
    /** Station of the public place; from @masl/shared/metro (ids are never reused). */
    metroStationId: varchar('metro_station_id', { length: 32 }).notNull(),
    /** Public approximate point = the station's point. Feed, ranking, distance and map use ONLY this. */
    publicLocation: geographyPoint('public_location').notNull(),
    /** Exact point is farther than PLACE_FAR_FROM_METRO_M from the station. */
    farFromMetro: boolean('far_from_metro').notNull().default(false),
    /** Number of participants the host needs, excluding the host ("+3"). */
    slots: smallint('slots').notNull(),
    /** Minimum karma to join; null means no filter. */
    minKarma: smallint('min_karma'),
    paymentFormat: paymentFormatEnum('payment_format').notNull().default('free'),
    status: lobbyStatusEnum('status').notNull().default('open'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    cancelComment: varchar('cancel_comment', { length: LOBBY_CANCEL_COMMENT_MAX }),
    /** Idempotency key of the create request (one per wizard draft); the API always sets it. */
    clientRequestId: uuid('client_request_id').notNull().defaultRandom(),
    /** Meetup group in Telegram; the invite link creates join requests the bot decides. */
    chatId: bigint('chat_id', { mode: 'number' }),
    chatTitle: varchar('chat_title', { length: 128 }),
    chatInviteLink: text('chat_invite_link'),
    chatLinkedAt: timestamp('chat_linked_at', { withTimezone: true }),
    /** The bot left or was removed; the group is no longer the lobby's. */
    chatClosedAt: timestamp('chat_closed_at', { withTimezone: true }),
    /** Scheduler steps, each set once by the step that handled the lobby (spec stage 3 §8). */
    quorumCheckedAt: timestamp('quorum_checked_at', { withTimezone: true }),
    endedNotifiedAt: timestamp('ended_notified_at', { withTimezone: true }),
    attendanceRequestedAt: timestamp('attendance_requested_at', { withTimezone: true }),
    attendanceRemindedAt: timestamp('attendance_reminded_at', { withTimezone: true }),
    attendanceSavedAt: timestamp('attendance_saved_at', { withTimezone: true }),
    attendanceClosedAt: timestamp('attendance_closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('lobbies_location_gist').using('gist', t.location),
    index('lobbies_status_starts_at_idx').on(t.status, t.startsAt),
    // For a future bbox query.
    index('lobbies_public_location_gist').using('gist', t.publicLocation),
    uniqueIndex('lobbies_host_request_uq').on(t.hostId, t.clientRequestId),
    // Rolling-window creation limits.
    index('lobbies_host_created_at_idx').on(t.hostId, t.createdAt),
    check('lobbies_time_order_chk', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'lobbies_slots_chk',
      sql`${t.slots} between ${sql.raw(String(LOBBY_SLOTS_MIN))} and ${sql.raw(String(LOBBY_SLOTS_MAX))}`,
    ),
    check('lobbies_min_karma_chk', sql`${t.minKarma} is null or ${t.minKarma} >= 0`),
    check(
      'lobbies_min_karma_max_chk',
      sql`${t.minKarma} is null or ${t.minKarma} <= ${sql.raw(String(LOBBY_MIN_KARMA_MAX))}`,
    ),
    check(
      'lobbies_cancel_consistency_chk',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
    check('lobbies_chat_consistency_chk', sql`(${t.chatId} is null) = (${t.chatLinkedAt} is null)`),
    // A group serves one lobby at a time.
    uniqueIndex('lobbies_active_chat_uq')
      .on(t.chatId)
      .where(sql`${t.chatId} is not null and ${t.chatClosedAt} is null`),
  ],
);

export const lobbyMembers = pgTable(
  'lobby_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lobbyId: uuid('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: membershipStatusEnum('status').notNull().default('pending'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    /** Joined the meetup group through a join request the bot approved. */
    chatJoinedAt: timestamp('chat_joined_at', { withTimezone: true }),
    /** The host's toggle in the bot's attendance poll, before the save. */
    attendanceAbsentDraft: boolean('attendance_absent_draft').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('lobby_members_lobby_user_uq').on(t.lobbyId, t.userId),
    index('lobby_members_user_status_idx').on(t.userId, t.status),
    index('lobby_members_lobby_status_idx').on(t.lobbyId, t.status),
    // 'cancelled' with decided_at set means approved, then left.
    check(
      'lobby_members_decided_chk',
      sql`${t.status} in ('pending','cancelled') or ${t.decidedAt} is not null`,
    ),
    check(
      'lobby_members_cancel_consistency_chk',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
  ],
);

/**
 * One row per apply, renewals after a withdrawal included (lobby_members keeps only the last).
 * Append-only; the applications-per-day cap counts these rows.
 */
export const applicationEvents = pgTable(
  'application_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lobbyId: uuid('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('application_events_user_created_idx').on(t.userId, t.createdAt)],
);

export const karmaEvents = pgTable(
  'karma_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lobbyId: uuid('lobby_id').references(() => lobbies.id, { onDelete: 'set null' }),
    reason: karmaReasonEnum('reason').notNull(),
    delta: integer('delta').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('karma_events_user_idx').on(t.userId, t.createdAt),
    // One award/penalty per reason per lobby, so reprocessing can't double-count karma.
    uniqueIndex('karma_events_once_per_lobby_uq')
      .on(t.userId, t.lobbyId, t.reason)
      .where(sql`${t.lobbyId} is not null`),
  ],
);

/** «Создать чат встречи»: the id is the request_id of the prepared request_chat button. */
export const lobbyChatRequests = pgTable('lobby_chat_requests', {
  id: serial('id').primaryKey(),
  lobbyId: uuid('lobby_id')
    .notNull()
    .references(() => lobbies.id, { onDelete: 'cascade' }),
  hostId: uuid('host_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

/**
 * Outbox of bot messages, written in the transaction of the change they report. Rows hold ids
 * only: the text, the exact address and the buttons are rendered from current rows at send time.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Private chat target. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Group target. */
    chatId: bigint('chat_id', { mode: 'number' }),
    lobbyId: uuid('lobby_id').references(() => lobbies.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => lobbyMembers.id, { onDelete: 'cascade' }),
    /** Moderation messages are about a case, not a lobby. */
    caseId: uuid('case_id').references(() => moderationCases.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 40 }).$type<NotificationKind>().notNull(),
    /** At most one pending row per key (debounce). */
    dedupeKey: varchar('dedupe_key', { length: 120 }),
    sendAfter: timestamp('send_after', { withTimezone: true }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    lastErrorCode: smallint('last_error_code'),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_due_idx')
      .on(t.sendAfter)
      .where(sql`${t.sentAt} is null and ${t.failedAt} is null`),
    uniqueIndex('notifications_pending_dedupe_uq')
      .on(t.dedupeKey)
      .where(sql`${t.sentAt} is null and ${t.failedAt} is null`),
    index('notifications_lobby_kind_idx').on(t.lobbyId, t.kind),
    check('notifications_target_chk', sql`(${t.userId} is null) <> (${t.chatId} is null)`),
    check('notifications_subject_chk', sql`${t.lobbyId} is not null or ${t.caseId} is not null`),
  ],
);

/** A member's answer to «Как прошла встреча?»; one per lobby and user. */
export const lobbyFeedback = pgTable(
  'lobby_feedback',
  {
    lobbyId: uuid('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: feedbackRatingEnum('rating').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.lobbyId, t.userId] })],
);

/**
 * A matter for moderators: reports on a host (one open case per host), a «Не состоялась»
 * answer (one open case per lobby) or an appeal against a creation block (one open per user).
 */
export const moderationCases = pgTable(
  'moderation_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: moderationCaseKindEnum('kind').notNull(),
    /** Whom the case is about: the reported host, the host of the lobby, the appellant. */
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** not_held: the lobby; appeal: the lobby behind the block; reports: none (see reports). */
    lobbyId: uuid('lobby_id').references(() => lobbies.id, { onDelete: 'set null' }),
    appealText: varchar('appeal_text', { length: APPEAL_TEXT_MAX }),
    /** reports: when the independent reports reached the threshold. */
    shadowBannedAt: timestamp('shadow_banned_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    decision: moderationDecisionEnum('decision'),
    decisionComment: varchar('decision_comment', { length: MODERATION_COMMENT_MAX }),
  },
  (t) => [
    uniqueIndex('moderation_cases_open_subject_uq')
      .on(t.kind, t.subjectId)
      .where(sql`${t.resolvedAt} is null and ${t.kind} <> 'not_held'`),
    uniqueIndex('moderation_cases_open_lobby_uq')
      .on(t.lobbyId)
      .where(sql`${t.resolvedAt} is null and ${t.kind} = 'not_held'`),
    index('moderation_cases_queue_idx')
      .on(t.openedAt)
      .where(sql`${t.resolvedAt} is null`),
    index('moderation_cases_subject_idx').on(t.subjectId, t.openedAt),
    check('moderation_cases_resolved_chk', sql`(${t.resolvedAt} is null) = (${t.decision} is null)`),
    check('moderation_cases_appeal_chk', sql`(${t.kind} = 'appeal') = (${t.appealText} is not null)`),
    check(
      'moderation_cases_decision_chk',
      sql`${t.decision} is null or (${t.kind} = 'reports' and ${t.decision} in (${decisionsOf('reports')})) or (${t.kind} = 'not_held' and ${t.decision} in (${decisionsOf('not_held')})) or (${t.kind} = 'appeal' and ${t.decision} in (${decisionsOf('appeal')}))`,
    ),
  ],
);

/** One report per reporter and lobby; it joins the subject's open reports case. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lobbyId: uuid('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'cascade' }),
    /** The lobby's host when reported. */
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => moderationCases.id, { onDelete: 'cascade' }),
    reason: reportReasonEnum('reason').notNull(),
    comment: varchar('comment', { length: REPORT_COMMENT_MAX }),
    /** Why the report doesn't count toward the shadow ban, decided when it was sent; null counts. */
    notCounted: varchar('not_counted', { length: 20 }).$type<ReportNotCounted>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('reports_reporter_lobby_uq').on(t.reporterId, t.lobbyId),
    index('reports_case_idx').on(t.caseId),
    index('reports_subject_idx').on(t.subjectId),
    // The daily cap.
    index('reports_reporter_created_idx').on(t.reporterId, t.createdAt),
  ],
);

/** Append-only log of moderation: every moderator action and the automatic shadow ban. */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Null: the system. */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    subjectId: uuid('subject_id').references(() => users.id, { onDelete: 'cascade' }),
    lobbyId: uuid('lobby_id').references(() => lobbies.id, { onDelete: 'set null' }),
    caseId: uuid('case_id').references(() => moderationCases.id, { onDelete: 'set null' }),
    action: moderationActionEnum('action').notNull(),
    karmaDelta: integer('karma_delta'),
    comment: varchar('comment', { length: MODERATION_COMMENT_MAX }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('moderation_actions_subject_idx').on(t.subjectId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Interest = typeof interests.$inferSelect;
export type Lobby = typeof lobbies.$inferSelect;
export type NewLobby = typeof lobbies.$inferInsert;
export type LobbyMember = typeof lobbyMembers.$inferSelect;
export type KarmaEvent = typeof karmaEvents.$inferSelect;
export type ApplicationEvent = typeof applicationEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ModerationCase = typeof moderationCases.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ModerationActionRow = typeof moderationActions.$inferSelect;
