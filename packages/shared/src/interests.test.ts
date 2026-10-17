import { describe, expect, it } from 'vitest';
import { LOBBY_CATEGORIES } from './enums.js';
import { INTERESTS, LOBBY_CATEGORY_INFO } from './interests.js';

describe('LOBBY_CATEGORY_INFO', () => {
  it('covers exactly the lobby categories', () => {
    expect(Object.keys(LOBBY_CATEGORY_INFO).sort()).toEqual([...LOBBY_CATEGORIES].sort());
    for (const category of LOBBY_CATEGORIES) {
      expect(LOBBY_CATEGORY_INFO[category].title).not.toBe('');
      expect(LOBBY_CATEGORY_INFO[category].emoji).not.toBe('');
    }
  });

  it('takes interest titles and emoji from INTERESTS and adds «Другое»', () => {
    for (const interest of INTERESTS) {
      expect(LOBBY_CATEGORY_INFO[interest.slug]).toEqual({ title: interest.title, emoji: interest.emoji });
    }
    expect(LOBBY_CATEGORY_INFO.other).toEqual({ title: 'Другое', emoji: '✨' });
  });
});
