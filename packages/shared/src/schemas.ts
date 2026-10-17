import { z } from 'zod';
import { AGE_MAX, AGE_MIN, INTERESTS_MAX, INTERESTS_MIN } from './constants.js';
import { GENDERS } from './enums.js';
import { INTERESTS } from './interests.js';

const interestSlug = z.enum(INTERESTS.map((i) => i.slug) as [string, ...string[]]);

/** POST /auth/telegram — raw initData string from Telegram.WebApp. */
export const telegramAuthInput = z.object({
  initData: z.string().min(1).max(4096),
});
export type TelegramAuthInput = z.infer<typeof telegramAuthInput>;

/** PUT /me/onboarding — onboarding is a single step. */
export const onboardingInput = z.object({
  gender: z.enum(GENDERS),
  age: z.number().int().min(AGE_MIN).max(AGE_MAX),
  interests: z
    .array(interestSlug)
    .min(INTERESTS_MIN)
    .max(INTERESTS_MAX)
    .refine((list) => new Set(list).size === list.length, 'Интересы не должны повторяться'),
});
export type OnboardingInput = z.infer<typeof onboardingInput>;

/** Current user's profile as returned by the API. */
export const meDto = z.object({
  id: z.string().uuid(),
  telegramId: z.number().int(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  username: z.string().nullable(),
  photoUrl: z.string().nullable(),
  gender: z.enum(GENDERS).nullable(),
  age: z.number().int().nullable(),
  karma: z.number().int(),
  interests: z.array(z.string()),
  onboarded: z.boolean(),
});
export type MeDto = z.infer<typeof meDto>;

export const authResponse = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: meDto,
});
export type AuthResponse = z.infer<typeof authResponse>;

export const interestDto = z.object({
  slug: z.string(),
  title: z.string(),
  emoji: z.string(),
});
export type InterestDto = z.infer<typeof interestDto>;
