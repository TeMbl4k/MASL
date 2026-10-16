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
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  GENDERS,
  KARMA,
  KARMA_REASONS,
  LOBBY_CATEGORIES,
  LOBBY_DESCRIPTION_MAX,
  LOBBY_SLOTS_MAX,
  LOBBY_SLOTS_MIN,
  LOBBY_STATUSES,
  LOBBY_TITLE_MAX,
  MEMBERSHIP_STATUSES,
  PAYMENT_FORMATS,
} from '@masl/shared';
import { geographyPoint } from './geo.js';

export const genderEnum = pgEnum('gender', GENDERS);
export const lobbyCategoryEnum = pgEnum('lobby_category', LOBBY_CATEGORIES);
export const lobbyStatusEnum = pgEnum('lobby_status', LOBBY_STATUSES);
export const paymentFormatEnum = pgEnum('payment_format', PAYMENT_FORMATS);
export const membershipStatusEnum = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const karmaReasonEnum = pgEnum('karma_reason', KARMA_REASONS);

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
    /** Telegram user id (до 52 бит, безопасно помещается в JS number). */
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
    firstName: varchar('first_name', { length: 128 }).notNull(),
    lastName: varchar('last_name', { length: 128 }),
    username: varchar('username', { length: 64 }),
    photoUrl: text('photo_url'),
    languageCode: varchar('language_code', { length: 16 }),
    /** Разрешил ли пользователь боту писать в личку (initData.user.allows_write_to_pm). */
    allowsWriteToPm: boolean('allows_write_to_pm').notNull().default(false),
    /** auth_date initData, из которой взят профиль: более старая initData его не перезаписывает. */
    telegramAuthDate: timestamp('telegram_auth_date', { withTimezone: true }).notNull(),
    gender: genderEnum('gender'),
    /** Храним год рождения, а не возраст, чтобы возраст не устаревал. */
    birthYear: smallint('birth_year'),
    /** Текущая карма = KARMA.START + сумма delta из karma_events. */
    karma: integer('karma').notNull().default(KARMA.START),
    /** Теневой бан до проверки модератором (3 жалобы). */
    isShadowBanned: boolean('is_shadow_banned').notNull().default(false),
    /** Блокировка создания лобби после host flake, снимается апелляцией. */
    lobbyCreationBlocked: boolean('lobby_creation_blocked').notNull().default(false),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_telegram_id_uq').on(t.telegramId)],
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
    /** Точное место. Отдаётся только хосту и одобренным участникам. */
    location: geographyPoint('location').notNull(),
    address: text('address').notNull(),
    /** Публичное примерное место для ленты и карточки, например «м. Динамо». */
    placeHint: varchar('place_hint', { length: 128 }).notNull(),
    /** Сколько участников нужно хосту (без учёта самого хоста), «+3». */
    slots: smallint('slots').notNull(),
    /** Порог кармы для входа; null — без фильтра. */
    minKarma: smallint('min_karma'),
    paymentFormat: paymentFormatEnum('payment_format').notNull().default('free'),
    status: lobbyStatusEnum('status').notNull().default('open'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    index('lobbies_location_gist').using('gist', t.location),
    index('lobbies_status_starts_at_idx').on(t.status, t.startsAt),
    index('lobbies_host_id_idx').on(t.hostId),
    check('lobbies_time_order_chk', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'lobbies_slots_chk',
      sql`${t.slots} between ${sql.raw(String(LOBBY_SLOTS_MIN))} and ${sql.raw(String(LOBBY_SLOTS_MAX))}`,
    ),
    check('lobbies_min_karma_chk', sql`${t.minKarma} is null or ${t.minKarma} >= 0`),
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
    ...timestamps,
  },
  (t) => [
    uniqueIndex('lobby_members_lobby_user_uq').on(t.lobbyId, t.userId),
    index('lobby_members_user_status_idx').on(t.userId, t.status),
    index('lobby_members_lobby_status_idx').on(t.lobbyId, t.status),
  ],
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
    // Одно начисление/штраф одного типа за одно лобби: повторная обработка не задвоит карму.
    uniqueIndex('karma_events_once_per_lobby_uq')
      .on(t.userId, t.lobbyId, t.reason)
      .where(sql`${t.lobbyId} is not null`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Interest = typeof interests.$inferSelect;
export type Lobby = typeof lobbies.$inferSelect;
export type NewLobby = typeof lobbies.$inferInsert;
export type LobbyMember = typeof lobbyMembers.$inferSelect;
export type KarmaEvent = typeof karmaEvents.$inferSelect;
