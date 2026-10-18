import { createSubscriber } from 'svelte/reactivity';

/** The part of an SDK signal (`@telegram-apps/signals`) the bridge needs. */
interface SdkSignal<T> {
  (): T;
  sub(fn: () => void): () => void;
}

/**
 * Bridges an SDK signal to runes: reading `.current` inside an effect or a template subscribes
 * to the signal for as long as the reader lives.
 */
export function fromSignal<T>(signal: SdkSignal<T>): { readonly current: T } {
  const subscribe = createSubscriber((update) => signal.sub(update));
  return {
    get current() {
      subscribe();
      return signal();
    },
  };
}
