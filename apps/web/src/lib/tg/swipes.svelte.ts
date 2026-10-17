import { disableVerticalSwipes, enableVerticalSwipes } from '@telegram-apps/sdk';

/**
 * Stops a vertical swipe from minimising the Mini App while the component is mounted
 * (map panning). Call during component init.
 */
export function useNoVerticalSwipes(): void {
  $effect(() => {
    disableVerticalSwipes.ifAvailable();
    return () => void enableVerticalSwipes.ifAvailable();
  });
}
