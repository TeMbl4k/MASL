import { describe, expect, it } from 'vitest';
import {
  achievementProgress,
  attendanceStreaks,
  earnedAchievements,
  nextAchievement,
  type AchievementMetrics,
} from './achievements.js';
import { ACHIEVEMENT_GOALS } from './constants.js';

const none: AchievementMetrics = {
  attended: 0,
  currentStreak: 0,
  bestStreak: 0,
  stations: 0,
  categories: 0,
  companions: 0,
  hosted: 0,
  fullHouses: 0,
  friends: 0,
};

describe('achievements', () => {
  it('earns nothing without marked meetups', () => {
    expect(earnedAchievements(none)).toEqual([]);
  });

  it('earns each threshold exactly at its goal', () => {
    expect(earnedAchievements({ ...none, attended: ACHIEVEMENT_GOALS.regular - 1 })).toEqual([
      'first_meetup',
    ]);
    expect(earnedAchievements({ ...none, attended: ACHIEVEMENT_GOALS.regular })).toEqual([
      'first_meetup',
      'regular',
    ]);
    expect(earnedAchievements({ ...none, hosted: 1, fullHouses: 1, friends: 1 })).toEqual([
      'first_hosted',
      'full_house',
      'brought_friend',
    ]);
  });

  it('earns «Без пропусков» by the best run and shows the current one', () => {
    const metrics = { ...none, attended: 12, currentStreak: 2, bestStreak: ACHIEVEMENT_GOALS.no_skips };
    expect(earnedAchievements(metrics)).toContain('no_skips');
    expect(achievementProgress(metrics, 'no_skips')).toEqual({
      current: 2,
      goal: ACHIEVEMENT_GOALS.no_skips,
    });
  });

  it('caps the progress at the goal', () => {
    expect(achievementProgress({ ...none, attended: 40 }, 'local')).toEqual({ current: 20, goal: 20 });
  });

  it('suggests the goal closest to done, then the first in shelf order', () => {
    const metrics = { ...none, attended: 3, currentStreak: 3, bestStreak: 3, stations: 1, categories: 1 };
    const earned = new Set(earnedAchievements(metrics));
    // 3 of 5 meetups beats 3 of 10 in a row and 1 of 4 categories.
    expect(nextAchievement(metrics, earned)).toBe('regular');
    expect(nextAchievement(none, new Set())).toBe('first_meetup');
  });

  it('counts runs of attended marks; a no-show resets the current one', () => {
    expect(attendanceStreaks([])).toEqual({ current: 0, best: 0 });
    expect(attendanceStreaks(['attended', 'attended', 'no_show', 'attended'])).toEqual({
      current: 1,
      best: 2,
    });
    expect(attendanceStreaks(['no_show', 'attended', 'attended', 'attended'])).toEqual({
      current: 3,
      best: 3,
    });
  });
});
