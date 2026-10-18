import { describe, expect, it } from 'vitest';
import { createStorage, type StorageKey } from './storage.js';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe('storage', () => {
  it('stores and removes allowlisted keys', () => {
    const backend = memoryStorage();
    const storage = createStorage(() => backend, true);
    storage.set('masl:origin-station:v1', '2-dinamo');
    expect(storage.get('masl:origin-station:v1')).toBe('2-dinamo');
    expect(backend.getItem('masl:origin-station:v1')).toBe('2-dinamo');
    storage.remove('masl:origin-station:v1');
    expect(storage.get('masl:origin-station:v1')).toBeNull();
  });

  it('throws on an unknown key in development and ignores it in production', () => {
    const backend = memoryStorage();
    const unknown = 'masl:lobby-address:v1' as StorageKey;
    expect(() => createStorage(() => backend, true).set(unknown, 'Тверская, 1')).toThrow(/allowlisted/);
    const production = createStorage(() => backend, false);
    production.set(unknown, 'Тверская, 1');
    expect(production.get(unknown)).toBeNull();
    expect(backend.length).toBe(0);
  });

  it('swallows a throwing or missing storage', () => {
    const throwing = createStorage(throwingStorage, true);
    expect(() => throwing.set('masl:lobby-draft:v1', '{}')).not.toThrow();
    expect(throwing.get('masl:lobby-draft:v1')).toBeNull();
    expect(() => throwing.remove('masl:lobby-draft:v1')).not.toThrow();

    const missing = createStorage(() => undefined, true);
    expect(missing.get('masl:recent-stations:v1')).toBeNull();
    expect(() => missing.set('masl:recent-stations:v1', '[]')).not.toThrow();
  });
});
