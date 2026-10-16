import { describe, expect, it } from 'vitest';
import { INTERESTS, INTEREST_SLUGS } from './interests.js';
import { LOBBY_CATEGORIES } from './enums.js';
import { onboardingInput } from './schemas.js';

describe('onboardingInput', () => {
  const valid = { gender: 'female', age: 24, interests: ['sport', 'bars', 'networking'] };

  it('accepts valid onboarding input', () => {
    expect(onboardingInput.parse(valid)).toEqual(valid);
  });

  it('requires 3 to 5 unique interests', () => {
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'bars'] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, interests: INTEREST_SLUGS.slice(0, 6) }).success).toBe(
      false,
    );
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'sport', 'bars'] }).success).toBe(
      false,
    );
  });

  it('rejects an unknown interest, age outside 18–99 and a fractional age', () => {
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'bars', 'nope'] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 17 }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 100 }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 20.5 }).success).toBe(false);
  });
});

describe('reference data', () => {
  it('every interest is a lobby category (for the "For you" feed)', () => {
    for (const interest of INTERESTS) {
      expect(LOBBY_CATEGORIES).toContain(interest.slug);
    }
  });

  it('interest slugs are unique', () => {
    expect(new Set(INTEREST_SLUGS).size).toBe(INTEREST_SLUGS.length);
  });
});
