/**
 * The only door to browser storage. Keys are allowlisted, so nothing exact (the lobby pin,
 * the address, the viewer's coordinates) can be persisted by accident. Every access is wrapped:
 * private modes and some webviews throw on localStorage.
 */
export const STORAGE_KEYS = [
  /** Station id chosen as the feed origin. */
  'masl:origin-station:v1',
  /** How the feed origin was last chosen without a station: `geo` or `city`. Never coordinates. */
  'masl:origin-choice:v1',
  /** JSON array of recently picked station ids. */
  'masl:recent-stations:v1',
  /** Wizard draft without point and address (wizard/draft-codec.ts). */
  'masl:lobby-draft:v1',
] as const;
export type StorageKey = (typeof STORAGE_KEYS)[number];

export interface AppStorage {
  get(key: StorageKey): string | null;
  set(key: StorageKey, value: string): void;
  remove(key: StorageKey): void;
}

function checkKey(key: string, dev: boolean): boolean {
  if ((STORAGE_KEYS as readonly string[]).includes(key)) return true;
  if (dev) throw new Error(`Storage key is not allowlisted: ${key}`);
  return false;
}

/** Storage over `backend()`; an unknown key throws in development and is ignored in production. */
export function createStorage(
  backend: () => Storage | undefined,
  dev: boolean = import.meta.env.DEV,
): AppStorage {
  return {
    get(key) {
      if (!checkKey(key, dev)) return null;
      try {
        return backend()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (!checkKey(key, dev)) return;
      try {
        backend()?.setItem(key, value);
      } catch {
        // Quota exceeded or storage disabled: the value just isn't remembered.
      }
    },
    remove(key) {
      if (!checkKey(key, dev)) return;
      try {
        backend()?.removeItem(key);
      } catch {
        // Storage disabled: nothing to remove.
      }
    },
  };
}

export const storage = createStorage(() => globalThis.localStorage);
