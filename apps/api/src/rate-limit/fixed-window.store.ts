/** Default cap on tracked keys, so a flood of users can't grow memory without bound. */
const DEFAULT_MAX_KEYS = 50_000;

interface Window {
  count: number;
  resetAt: number;
}

export interface WindowHit {
  key: string;
  limit: number;
  windowMs: number;
}

export type TakeResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * In-memory fixed-window counters (one app instance in production). A window starts at the
 * first hit of a key and lasts windowMs.
 */
export class FixedWindowStore {
  readonly #windows = new Map<string, Window>();

  constructor(private readonly maxKeys: number = DEFAULT_MAX_KEYS) {}

  /**
   * Counts one request against every window, all or nothing: if any window is full, none is
   * incremented, and retryAfterMs is the longest wait among the full ones.
   */
  take(hits: readonly WindowHit[], nowMs: number): TakeResult {
    let retryAfterMs = 0;
    for (const hit of hits) {
      const window = this.#current(hit.key, nowMs);
      if (window && window.count >= hit.limit) {
        retryAfterMs = Math.max(retryAfterMs, window.resetAt - nowMs);
      }
    }
    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterMs };
    }
    for (const hit of hits) {
      const window = this.#current(hit.key, nowMs);
      if (window) {
        window.count += 1;
      } else {
        this.#insert(hit.key, { count: 1, resetAt: nowMs + hit.windowMs }, nowMs);
      }
    }
    return { allowed: true };
  }

  /** Drops expired windows. */
  sweep(nowMs: number): void {
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= nowMs) this.#windows.delete(key);
    }
  }

  /** Forgets every window (tests reset limits between cases). */
  clear(): void {
    this.#windows.clear();
  }

  get size(): number {
    return this.#windows.size;
  }

  #current(key: string, nowMs: number): Window | undefined {
    const window = this.#windows.get(key);
    if (window && window.resetAt <= nowMs) {
      this.#windows.delete(key);
      return undefined;
    }
    return window;
  }

  #insert(key: string, window: Window, nowMs: number): void {
    if (this.#windows.size >= this.maxKeys) {
      this.sweep(nowMs);
    }
    if (this.#windows.size >= this.maxKeys) {
      // Still full of live windows: forget the oldest one rather than refuse everyone.
      const oldest = this.#windows.keys().next().value;
      if (oldest !== undefined) this.#windows.delete(oldest);
    }
    this.#windows.set(key, window);
  }
}
