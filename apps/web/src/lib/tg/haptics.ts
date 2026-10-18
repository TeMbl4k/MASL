import {
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
  hapticFeedbackSelectionChanged,
} from '@telegram-apps/sdk';

/**
 * Haptic feedback; silent outside Telegram.
 * select: chips, days, steppers, tabs · tap: a sheet opens · action: a MainButton action starts ·
 * success / warning / error: results, destructive confirms, validation and API errors.
 */
export const haptic = {
  select: () => void hapticFeedbackSelectionChanged.ifAvailable(),
  tap: () => void hapticFeedbackImpactOccurred.ifAvailable('light'),
  action: () => void hapticFeedbackImpactOccurred.ifAvailable('medium'),
  success: () => void hapticFeedbackNotificationOccurred.ifAvailable('success'),
  warning: () => void hapticFeedbackNotificationOccurred.ifAvailable('warning'),
  error: () => void hapticFeedbackNotificationOccurred.ifAvailable('error'),
};
