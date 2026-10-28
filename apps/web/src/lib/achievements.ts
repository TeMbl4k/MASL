import { ACHIEVEMENTS, type Achievement, type AchievementDto } from '@masl/shared';

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const roundedSquare = (x: number, y: number) =>
  `M${x + 1.5} ${y}h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5z`;

/** Line icons of the achievements on a 24×24 grid (the stage 7 mockups). */
export const ACHIEVEMENT_ICONS: Readonly<Record<Achievement, string>> = {
  first_meetup: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  regular:
    'M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 3v4M16 3v4M4 10h16M9 15l2 2 4-4',
  local: 'M4 11l8-7 8 7v9H4zM12 17.5s-3-1.8-3-3.7a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.9-3 3.7-3 3.7z',
  no_skips: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  explorer: `${circle(12, 12, 9)}M15.5 8.5l-2 5-5 2 2-5z`,
  versatile: [roundedSquare(4, 4), roundedSquare(13, 4), roundedSquare(4, 13), roundedSquare(13, 13)].join(
    '',
  ),
  sociable: 'M4 6h10v7H8l-4 3zM14 9h6v7l-3-2h-5v-1',
  first_hosted: 'M5 21V4h11l-2 4 2 4H5',
  organizer: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  full_house: `${circle(8, 9, 3)}${circle(16, 9, 3)}M2.5 19c.7-3 2.8-4.5 5.5-4.5s4.8 1.5 5.5 4.5M12.5 15.2c1-.5 2.2-.7 3.5-.7 2.7 0 4.8 1.5 5.5 4.5`,
  brought_friend: `${circle(9, 8, 3.5)}M2.5 20c.8-3.5 3.5-5.5 6.5-5.5s5.7 2 6.5 5.5M19 8v6M16 11h6`,
  ambassador: 'M3 10v4h3l7 5V5L6 10zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11',
};

/** Earned ones, the latest first: the profile shelf. */
export function latestEarned(items: readonly AchievementDto[], count: number): Achievement[] {
  return items
    .filter((item) => item.earnedAt !== null)
    .sort(
      (a, b) =>
        b.earnedAt!.localeCompare(a.earnedAt!) || ACHIEVEMENTS.indexOf(a.id) - ACHIEVEMENTS.indexOf(b.id),
    )
    .slice(0, count)
    .map((item) => item.id);
}

/** Share of the goal as a CSS width, 0–100%. */
export const progressWidth = (current: number, goal: number) =>
  `${Math.round((Math.min(current, goal) / goal) * 100)}%`;
