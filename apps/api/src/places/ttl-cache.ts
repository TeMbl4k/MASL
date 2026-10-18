interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Bounded in-memory cache with a TTL. When full, the least recently used entry goes first
 * (a Map keeps insertion order, and a hit re-inserts its key).
 */
export class TtlCache<V> {
  readonly #entries = new Map<string, Entry<V>>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  /** The value, or undefined on a miss or an expired entry. */
  get(key: string, nowMs: number): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    if (entry.expiresAt <= nowMs) return undefined;
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, nowMs: number): void {
    this.#entries.delete(key);
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(key, { value, expiresAt: nowMs + this.ttlMs });
  }

  get size(): number {
    return this.#entries.size;
  }
}
