import { isMiniAppActive, isMiniAppMounted } from '@telegram-apps/sdk';
import { untrack } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';
import { fromSignal } from '../tg/signal.js';

const TICK_MS = 30_000;

const miniAppMounted = fromSignal(isMiniAppMounted);
const miniAppActive = fromSignal(isMiniAppActive);

const subscribeVisibility = createSubscriber((update) => {
  document.addEventListener('visibilitychange', update);
  return () => document.removeEventListener('visibilitychange', update);
});

/**
 * The app is in front of the user: the page is visible and Telegram hasn't minimised the
 * Mini App. Telegram iOS doesn't reliably fire `visibilitychange` when minimised, hence both.
 * Reactive: read it in an effect to refetch when the app comes back.
 */
export const appActivity = {
  get active(): boolean {
    subscribeVisibility();
    return document.visibilityState === 'visible' && (!miniAppMounted.current || miniAppActive.current);
  },
};

/** Current time for labels that move («Через 2 ч 15 мин», statuses); ticks every 30 s while active. */
class Clock {
  #now = Date.now();
  #subscribe = createSubscriber((update) => {
    const tick = () => {
      if (!appActivity.active) return;
      this.#now = Date.now();
      update();
    };
    this.#now = Date.now();
    const timer = setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', tick);
    const offActive = isMiniAppActive.sub(tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      offActive();
    };
  });

  /** Outside an effect this is simply Date.now(). */
  get now(): number {
    if (!$effect.tracking()) return Date.now();
    this.#subscribe();
    return this.#now;
  }
}

export const clock = new Clock();

/**
 * Calls `refresh` on mount and each time the app comes back to the front (stale-while-revalidate
 * on tab roots: `refresh` decides whether the data is old enough).
 */
export function useRefreshWhenActive(refresh: () => void): void {
  $effect(() => {
    if (appActivity.active) untrack(refresh);
  });
}

/** Calls `poll` every `ms` while the app is in front and `enabled()` is true; pauses otherwise. */
export function usePolling(poll: () => void, ms: number, enabled: () => boolean = () => true): void {
  $effect(() => {
    if (!appActivity.active || !enabled()) return;
    const timer = setInterval(() => untrack(poll), ms);
    return () => clearInterval(timer);
  });
}
