import type { UserRole } from '@masl/shared';

/** Admin: a Telegram id in ADMIN_TELEGRAM_IDS; moderator: users.is_moderator (spec stage 4 §2.1). */
export function userRole(
  user: { telegramId: number; isModerator: boolean },
  adminIds: readonly number[],
): UserRole {
  if (adminIds.includes(user.telegramId)) return 'admin';
  return user.isModerator ? 'moderator' : 'user';
}
