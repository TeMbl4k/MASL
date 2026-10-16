import { describe, expect, it } from 'vitest';
import { INTERESTS, INTEREST_SLUGS } from './interests.js';
import { LOBBY_CATEGORIES } from './enums.js';
import { onboardingInput } from './schemas.js';

describe('onboardingInput', () => {
  const valid = { gender: 'female', age: 24, interests: ['sport', 'bars', 'networking'] };

  it('принимает корректный онбординг', () => {
    expect(onboardingInput.parse(valid)).toEqual(valid);
  });

  it('требует от 3 до 5 интересов без повторов', () => {
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'bars'] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, interests: INTEREST_SLUGS.slice(0, 6) }).success).toBe(
      false,
    );
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'sport', 'bars'] }).success).toBe(
      false,
    );
  });

  it('отклоняет неизвестный интерес, возраст вне 18–99 и дробный возраст', () => {
    expect(onboardingInput.safeParse({ ...valid, interests: ['sport', 'bars', 'nope'] }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 17 }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 100 }).success).toBe(false);
    expect(onboardingInput.safeParse({ ...valid, age: 20.5 }).success).toBe(false);
  });
});

describe('справочники', () => {
  it('каждый интерес — это категория лобби (для ленты «Для вас»)', () => {
    for (const interest of INTERESTS) {
      expect(LOBBY_CATEGORIES).toContain(interest.slug);
    }
  });

  it('slug интересов уникальны', () => {
    expect(new Set(INTEREST_SLUGS).size).toBe(INTEREST_SLUGS.length);
  });
});
