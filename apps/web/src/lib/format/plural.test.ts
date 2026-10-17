import { describe, expect, it } from 'vitest';
import { LOBBY_FORMS, plural, pluralForm } from './plural.js';

describe('plural', () => {
  it('picks the Russian form by the last digits', () => {
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map((n) => plural(n, LOBBY_FORMS))).toEqual(
      [
        '0 встреч',
        '1 встреча',
        '2 встречи',
        '4 встречи',
        '5 встреч',
        '11 встреч',
        '12 встреч',
        '14 встреч',
        '21 встреча',
        '22 встречи',
        '25 встреч',
        '101 встреча',
        '111 встреч',
        '112 встреч',
      ],
    );
  });

  it('handles negative numbers by their absolute value', () => {
    expect(pluralForm(-1, LOBBY_FORMS)).toBe('встреча');
    expect(pluralForm(-15, LOBBY_FORMS)).toBe('встреч');
  });
});
