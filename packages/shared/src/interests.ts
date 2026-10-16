import type { LobbyCategory } from './enums.js';

export interface InterestDefinition {
  slug: Exclude<LobbyCategory, 'other'>;
  title: string;
  emoji: string;
}

/**
 * Облако интересов на онбординге. Slug совпадает с категорией лобби:
 * совпадение интересов пользователя с категорией поднимает лобби в ленте «Для вас».
 * Источник правды для сида таблицы interests.
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
