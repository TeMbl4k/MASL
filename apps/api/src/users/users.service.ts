import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, ne, or, sql, type SQLWrapper } from 'drizzle-orm';
import {
  linkTags,
  userActivityDays,
  userArrivals,
  userInterests,
  users,
  type Database,
  type User,
} from '@masl/db';
import {
  ARRIVAL_WINDOW_HOURS,
  HOUR_MS,
  TERMS_VERSION,
  moscowDayKey,
  parseStartParam,
  type AcceptTermsInput,
  type ArrivalResponse,
  type MeDto,
  type OnboardingInput,
  type PrivacyInput,
  type UpdateInterestsInput,
  type UserRole,
} from '@masl/shared';
import type { TelegramIdentity } from '../auth/init-data.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { countOpenCases } from '../moderation/admin-queries.js';
import { userRole } from '../moderation/roles.js';
import { termsAccepted } from './terms.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Creates the user on first sign-in or refreshes Telegram data on later ones.
   * The profile is taken only from initData no older than the stored one, so stale initData
   * (it can be replayed within INIT_DATA_MAX_AGE_SECONDS) can't roll back username and photo.
   */
  async upsertFromTelegram(identity: TelegramIdentity): Promise<User> {
    const isNewer = sql`excluded.telegram_auth_date >= ${users.telegramAuthDate}`;
    const fromNewer = (column: SQLWrapper, name: string) =>
      sql`case when ${isNewer} then excluded.${sql.identifier(name)} else ${column} end`;

    const [user] = await this.db
      .insert(users)
      .values({
        telegramId: identity.telegramId,
        firstName: identity.firstName,
        lastName: identity.lastName,
        username: identity.username,
        photoUrl: identity.photoUrl,
        languageCode: identity.languageCode,
        allowsWriteToPm: identity.allowsWriteToPm,
        telegramAuthDate: identity.authDate,
      })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: {
          firstName: fromNewer(users.firstName, 'first_name'),
          lastName: fromNewer(users.lastName, 'last_name'),
          username: fromNewer(users.username, 'username'),
          photoUrl: fromNewer(users.photoUrl, 'photo_url'),
          languageCode: fromNewer(users.languageCode, 'language_code'),
          allowsWriteToPm: fromNewer(users.allowsWriteToPm, 'allows_write_to_pm'),
          telegramAuthDate: sql`greatest(excluded.telegram_auth_date, ${users.telegramAuthDate})`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    // A sign-in is an app opening: the user counts toward the day's uniques.
    await this.db
      .insert(userActivityDays)
      .values({ userId: user!.id, day: moscowDayKey(this.clock.now()) })
      .onConflictDoNothing();
    return user!;
  }

  /**
   * Records where a new user came from: the first valid link within ARRIVAL_WINDOW_HOURS of
   * sign-up. A link of an unknown person or tag, or the user's own, is not a source.
   */
  async recordArrival(userId: string, startParam: string): Promise<ArrivalResponse> {
    const link = parseStartParam(startParam);
    if (!link?.source) return { recorded: false };
    const now = this.clock.now();
    const [user] = await this.db
      .select({ createdAt: users.createdAt, publicCode: users.publicCode })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || now.getTime() - user.createdAt.getTime() > ARRIVAL_WINDOW_HOURS * HOUR_MS) {
      return { recorded: false };
    }
    let source: { referrerId: string } | { tagId: number } | null = null;
    if (link.source.kind === 'ref') {
      const [referrer] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.publicCode, link.source.code));
      source = referrer && referrer.id !== userId ? { referrerId: referrer.id } : null;
    } else {
      const [tag] = await this.db
        .select({ id: linkTags.id })
        .from(linkTags)
        .where(eq(linkTags.slug, link.source.slug));
      source = tag ? { tagId: tag.id } : null;
    }
    if (!source) return { recorded: false };
    const inserted = await this.db
      .insert(userArrivals)
      .values({ userId, ...source, createdAt: now })
      .onConflictDoNothing()
      .returning({ userId: userArrivals.userId });
    return { recorded: inserted.length > 0 };
  }

  /** «Не показывать меня в поиске» and «Приглашения на встречи»; the caller's own row only. */
  async updatePrivacy(userId: string, input: PrivacyInput): Promise<MeDto> {
    const now = this.clock.now();
    await this.db
      .update(users)
      .set({ hideFromSearch: input.hideFromSearch, invitesEnabled: input.invitesEnabled, updatedAt: now })
      .where(eq(users.id, userId));
    return this.getMe(userId);
  }

  async getMe(userId: string): Promise<MeDto> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    const role = userRole(user, this.env.ADMIN_TELEGRAM_IDS);
    const queue = role === 'user' ? null : await countOpenCases(this.db);
    return this.toMeDto(user, await this.interestsOf(userId), role, queue);
  }

  /**
   * 403 `not_onboarded` unless the user finished onboarding, `terms_not_accepted` unless the
   * current user agreement is accepted; both read fresh from the DB.
   * Inside `tx` the user row is also locked (FOR NO KEY UPDATE), the first lock of the call.
   */
  async requireOnboarded(userId: string, tx?: DbTransaction): Promise<void> {
    const query = (tx ?? this.db)
      .select({ onboardedAt: users.onboardedAt, termsVersion: users.termsVersion })
      .from(users)
      .where(eq(users.id, userId));
    const [user] = tx ? await query.for('no key update') : await query;
    if (!user?.onboardedAt) {
      throw apiError('not_onboarded');
    }
    if (!termsAccepted(user)) {
      throw apiError('terms_not_accepted');
    }
  }

  /**
   * Accepts the current user agreement. A repeat keeps the first acceptance time; a version
   * other than TERMS_VERSION (an app opened before the agreement changed) answers 409.
   */
  async acceptTerms(userId: string, input: AcceptTermsInput): Promise<MeDto> {
    if (input.version !== TERMS_VERSION) {
      throw apiError('terms_outdated');
    }
    const now = this.clock.now();
    await this.db
      .update(users)
      .set({ termsVersion: TERMS_VERSION, termsAcceptedAt: now, updatedAt: now })
      .where(
        and(eq(users.id, userId), or(isNull(users.termsVersion), ne(users.termsVersion, TERMS_VERSION))),
      );
    return this.getMe(userId);
  }

  async completeOnboarding(userId: string, input: OnboardingInput, now: Date = new Date()): Promise<MeDto> {
    const birthYear = now.getUTCFullYear() - input.age;
    await this.db.transaction(async (tx) => {
      // Profile data is asked for only after the agreement is accepted.
      const [user] = await tx
        .select({ termsVersion: users.termsVersion })
        .from(users)
        .where(eq(users.id, userId))
        .for('no key update');
      if (user && !termsAccepted(user)) {
        throw apiError('terms_not_accepted');
      }
      const updated = await tx
        .update(users)
        .set({
          gender: input.gender,
          birthYear,
          onboardedAt: sql`coalesce(${users.onboardedAt}, now())`,
        })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (updated.length === 0) {
        throw new NotFoundException('Пользователь не найден');
      }
      await this.replaceInterests(tx, userId, input.interests);
    });
    return this.getMe(userId);
  }

  /** Replaces the interests chosen at onboarding; only the caller's own row is touched. */
  async updateInterests(userId: string, input: UpdateInterestsInput): Promise<MeDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await this.requireOnboarded(userId, tx);
      await this.replaceInterests(tx, userId, input.interests);
      await tx.update(users).set({ updatedAt: now }).where(eq(users.id, userId));
    });
    return this.getMe(userId);
  }

  toMeDto(
    user: User,
    interestSlugs: string[],
    role: UserRole,
    moderationQueue: number | null,
    now: Date = new Date(),
  ): MeDto {
    return {
      id: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      gender: user.gender,
      age: user.birthYear === null ? null : now.getUTCFullYear() - user.birthYear,
      karma: user.karma,
      interests: interestSlugs,
      onboarded: user.onboardedAt !== null,
      termsAccepted: termsAccepted(user),
      botCanWrite: user.allowsWriteToPm,
      role,
      moderationQueue,
      publicCode: user.publicCode,
      hideFromSearch: user.hideFromSearch,
      invitesEnabled: user.invitesEnabled,
    };
  }

  private async replaceInterests(tx: DbTransaction, userId: string, slugs: readonly string[]): Promise<void> {
    await tx.delete(userInterests).where(eq(userInterests.userId, userId));
    await tx.insert(userInterests).values(slugs.map((slug) => ({ userId, interestSlug: slug })));
  }

  private async interestsOf(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: userInterests.interestSlug })
      .from(userInterests)
      .where(eq(userInterests.userId, userId))
      .orderBy(asc(userInterests.interestSlug));
    return rows.map((r) => r.slug);
  }
}
