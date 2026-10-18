import { disableClosingConfirmation, enableClosingConfirmation } from '@telegram-apps/sdk';

/**
 * Asks Telegram to confirm closing the Mini App while `dirty()` is true (an unsaved draft).
 * Call during component init; it turns off when the component unmounts.
 */
export function useClosingConfirmation(dirty: () => boolean): void {
  $effect(() => {
    if (!dirty()) return;
    enableClosingConfirmation.ifAvailable();
    return () => void disableClosingConfirmation.ifAvailable();
  });
}
