import { ACHIEVEMENT_GOALS, FULL_HOUSE_MIN_SLOTS } from './constants.js';
import { ACHIEVEMENTS, type Achievement, type AchievementGroup } from './enums.js';

/**
 * What the achievements are counted from (stage 7). A meetup counts by the same mark as the
 * karma for attendance: the host's mark or «Я на месте». Hosted meetups are the user's own
 * lobbies with at least one attended member; a host's own lobby never counts as attended.
 */
export interface AchievementMetrics {
  attended: number;
  /** Attended meetups since the last no-show; cancellations don't count either way. */
  currentStreak: number;
  /** The longest such run ever. */
  bestStreak: number;
  stations: number;
  categories: number;
  companions: number;
  hosted: number;
  /** Hosted meetups of at least FULL_HOUSE_MIN_SLOTS places where every place was attended. */
  fullHouses: number;
  /** People who came by the user's link and were marked present at another host's meetup. */
  friends: number;
}

interface AchievementRule {
  group: AchievementGroup;
  /** The number shown as progress. */
  progress: keyof AchievementMetrics;
  /** The number that earns it, when other than the progress (a run that already ended). */
  earnedBy?: keyof AchievementMetrics;
}

const RULES: Readonly<Record<Achievement, AchievementRule>> = {
  first_meetup: { group: 'meetups', progress: 'attended' },
  regular: { group: 'meetups', progress: 'attended' },
  local: { group: 'meetups', progress: 'attended' },
  no_skips: { group: 'meetups', progress: 'currentStreak', earnedBy: 'bestStreak' },
  explorer: { group: 'meetups', progress: 'stations' },
  versatile: { group: 'meetups', progress: 'categories' },
  sociable: { group: 'meetups', progress: 'companions' },
  first_hosted: { group: 'hosting', progress: 'hosted' },
  organizer: { group: 'hosting', progress: 'hosted' },
  full_house: { group: 'hosting', progress: 'fullHouses' },
  brought_friend: { group: 'friends', progress: 'friends' },
  ambassador: { group: 'friends', progress: 'friends' },
};

export const achievementGroup = (id: Achievement): AchievementGroup => RULES[id].group;

/** Progress toward `id`, capped at its goal. */
export function achievementProgress(
  metrics: AchievementMetrics,
  id: Achievement,
): { current: number; goal: number } {
  const goal = ACHIEVEMENT_GOALS[id];
  return { current: Math.min(metrics[RULES[id].progress], goal), goal };
}

/** The achievements the metrics earn, in shelf order. */
export function earnedAchievements(metrics: AchievementMetrics): Achievement[] {
  return ACHIEVEMENTS.filter(
    (id) => metrics[RULES[id].earnedBy ?? RULES[id].progress] >= ACHIEVEMENT_GOALS[id],
  );
}

/**
 * The goal to show next: of those not earned, the one closest to done by share, then in shelf
 * order; null when all are earned.
 */
export function nextAchievement(
  metrics: AchievementMetrics,
  earned: ReadonlySet<Achievement>,
): Achievement | null {
  let best: { id: Achievement; share: number } | null = null;
  for (const id of ACHIEVEMENTS) {
    if (earned.has(id)) continue;
    const { current, goal } = achievementProgress(metrics, id);
    const share = current / goal;
    if (!best || share > best.share) best = { id, share };
  }
  return best?.id ?? null;
}

const g = ACHIEVEMENT_GOALS;

/** Russian texts: the title, the condition on «Мои ачивки», the line on getting it. */
export const ACHIEVEMENT_TEXTS: Readonly<
  Record<Achievement, { title: string; condition: string; praise: string }>
> = {
  first_meetup: {
    title: 'Первая встреча',
    condition: 'Отметка на первой встрече',
    praise: 'Вы сходили на первую встречу. С почином!',
  },
  regular: {
    title: 'Завсегдатай',
    condition: `${g.regular} встреч`,
    praise: `Вы побывали на ${g.regular} встречах. Спасибо, что приходите!`,
  },
  local: {
    title: 'Свой человек',
    condition: `${g.local} встреч`,
    praise: `Вы побывали на ${g.local} встречах. Здесь вы свой человек!`,
  },
  no_skips: {
    title: 'Без пропусков',
    condition: `${g.no_skips} встреч подряд без неявки`,
    praise: `${g.no_skips} встреч подряд без единой неявки. На вас можно положиться!`,
  },
  explorer: {
    title: 'Исследователь',
    condition: `Встречи у ${g.explorer} разных станций`,
    praise: `Вы встречались у ${g.explorer} разных станций. Москва большая!`,
  },
  versatile: {
    title: 'Разносторонний',
    condition: `Встречи в ${g.versatile} разных категориях`,
    praise: `Вы попробовали встречи ${g.versatile} разных видов.`,
  },
  sociable: {
    title: 'Компанейский',
    condition: `${g.sociable} напарников`,
    praise: `У вас ${g.sociable} напарников: столько людей вы встретили вживую.`,
  },
  first_hosted: {
    title: 'Первая своя',
    condition: 'Провели встречу, кто-то пришёл',
    praise: 'Вы провели свою первую встречу. Хостов мало, спасибо!',
  },
  organizer: {
    title: 'Организатор',
    condition: `${g.organizer} проведённых встреч`,
    praise: `Вы провели ${g.organizer} встреч, на которые пришли люди.`,
  },
  full_house: {
    title: 'Полный сбор',
    condition: `На вашу встречу от ${FULL_HOUSE_MIN_SLOTS} мест пришли все`,
    praise: 'На вашу встречу пришли все. Спасибо, что собрали компанию!',
  },
  brought_friend: {
    title: 'Привёл друга',
    condition: 'Друг по вашей ссылке дошёл до встречи',
    praise: 'Друг, который пришёл по вашей ссылке, сходил на встречу.',
  },
  ambassador: {
    title: 'Амбассадор',
    condition: `${g.ambassador} друзей дошли до встречи`,
    praise: `${g.ambassador} друзей по вашей ссылке дошли до встречи.`,
  },
};

/** Attended and no-show marks in meetup order → the current and the longest run of attended. */
export function attendanceStreaks(marks: readonly ('attended' | 'no_show')[]): {
  current: number;
  best: number;
} {
  let current = 0;
  let best = 0;
  for (const mark of marks) {
    current = mark === 'attended' ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}
