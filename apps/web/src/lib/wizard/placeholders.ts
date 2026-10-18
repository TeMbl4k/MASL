import type { LobbyCategory } from '@masl/shared';

/** Title placeholder per category on wizard step 1. */
export const TITLE_PLACEHOLDERS: Readonly<Record<LobbyCategory, string>> = {
  sport: 'Например: Падел 2×2 в Лужниках',
  boardgames: 'Например: Играем в «Кодовые имена»',
  bars: 'Например: Квиз в баре на Чистых прудах',
  food: 'Например: Пробуем рамен на Патриарших',
  networking: 'Например: Завтрак продакт-менеджеров',
  videogames: 'Например: Турнир по FIFA на PS5',
  cinema: 'Например: Вечерний сеанс в IMAX',
  music: 'Например: Джем для гитаристов',
  walks: 'Например: Прогулка по Нескучному саду',
  culture: 'Например: Идём в Третьяковку',
  other: 'Например: Учимся играть в го',
};

/** Before a category is chosen. */
export const TITLE_PLACEHOLDER_DEFAULT = 'Как назовём встречу?';

export const DESCRIPTION_PLACEHOLDER = 'Что взять, какой уровень, как узнать друг друга';

/** Step 1 hint: the public text is visible to everyone, the address only to approved members. */
export const EXACT_ADDRESS_HINT =
  'Не пишите точный адрес в названии и описании — его увидят только одобренные участники';
