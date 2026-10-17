import type { LobbyCategory } from './enums.js';

export interface InterestDefinition {
  slug: Exclude<LobbyCategory, 'other'>;
  title: string;
  emoji: string;
}

/**
 * Interest cloud shown at onboarding. Each slug equals a lobby category:
 * a lobby whose category matches the user's interests ranks higher in the "For you" feed.
 * Source of truth for seeding the interests table.
 */
export const INTERESTS: readonly InterestDefinition[] = [
  { slug: 'sport', title: 'Спорт', emoji: '🏀' },
  { slug: 'boardgames', title: 'Настолки', emoji: '🎲' },
  { slug: 'bars', title: 'Бары', emoji: '🍻' },
  { slug: 'food', title: 'Еда', emoji: '🍜' },
  { slug: 'networking', title: 'Нетворкинг', emoji: '💼' },
  { slug: 'videogames', title: 'Видеоигры', emoji: '🎮' },
  { slug: 'cinema', title: 'Кино', emoji: '🎬' },
  { slug: 'music', title: 'Музыка', emoji: '🎸' },
  { slug: 'walks', title: 'Прогулки', emoji: '🚶' },
  { slug: 'culture', title: 'Выставки и театр', emoji: '🎭' },
];

export const INTEREST_SLUGS = INTERESTS.map((i) => i.slug);
