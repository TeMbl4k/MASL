import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { userInterests, users, type Database, type User } from '@masl/db';
import type { MeDto, OnboardingInput } from '@masl/shared';
import type { TelegramIdentity } from '../auth/init-data.service.js';
import { DB } from '../db/db.module.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

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
    return user!;
  }

  async getMe(userId: string): Promise<MeDto> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    return this.toMeDto(user, await this.interestsOf(userId));
  }

  async completeOnboarding(userId: string, input: OnboardingInput, now: Date = new Date()): Promise<MeDto> {
    const birthYear = now.getUTCFullYear() - input.age;
    await this.db.transaction(async (tx) => {
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
      await tx.delete(userInterests).where(eq(userInterests.userId, userId));
      await tx.insert(userInterests).values(input.interests.map((slug) => ({ userId, interestSlug: slug })));
    });
    return this.getMe(userId);
  }

  toMeDto(user: User, interestSlugs: string[], now: Date = new Date()): MeDto {
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
    };
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
