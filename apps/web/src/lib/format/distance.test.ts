import { describe, expect, it } from 'vitest';
import { formatDistance } from './distance.js';

describe('formatDistance', () => {
  it('hides the exact value under a kilometre', () => {
    expect(formatDistance(0)).toBe('< 1 км');
    expect(formatDistance(900)).toBe('< 1 км');
  });

  it('keeps one decimal up to 10 km with a comma, without a trailing zero', () => {
    expect(formatDistance(1000)).toBe('1 км');
    expect(formatDistance(2400)).toBe('2,4 км');
    expect(formatDistance(2449)).toBe('2,4 км');
    expect(formatDistance(9900)).toBe('9,9 км');
    expect(formatDistance(9960)).toBe('10 км');
  });

  it('rounds to whole kilometres from 10 km', () => {
    expect(formatDistance(10_000)).toBe('10 км');
    expect(formatDistance(12_400)).toBe('12 км');
    expect(formatDistance(12_600)).toBe('13 км');
  });
});
