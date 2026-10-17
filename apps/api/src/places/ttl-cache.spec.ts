import { TtlCache } from './ttl-cache.js';

describe('TtlCache', () => {
  it('returns a value until its TTL ends', () => {
    const cache = new TtlCache<string | null>(10, 1000);
    cache.set('a', null, 0);
    expect(cache.get('a', 999)).toBeNull();
    expect(cache.get('a', 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new TtlCache<number>(2, 1000);
    cache.set('a', 1, 0);
    cache.set('b', 2, 0);
    expect(cache.get('a', 1)).toBe(1);
    cache.set('c', 3, 2);
    expect(cache.get('b', 3)).toBeUndefined();
    expect(cache.get('a', 3)).toBe(1);
    expect(cache.get('c', 3)).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('overwriting a key restarts its TTL without growing the cache', () => {
    const cache = new TtlCache<number>(2, 1000);
    cache.set('a', 1, 0);
    cache.set('a', 2, 500);
    expect(cache.size).toBe(1);
    expect(cache.get('a', 1400)).toBe(2);
  });
});
