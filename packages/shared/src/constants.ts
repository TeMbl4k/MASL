/**
 * Продуктовые константы из концепт-документа (code_artifact.md, gemini-code-*.md).
 * Значения, которых нет в ТЗ, сюда не добавляем: их сначала решает продукт.
 */

/** Карма (индекс надёжности). */
export const KARMA = {
  /** Стартовая карма новичка. */
  START: 50,
  /** Явка на встречу (чек-ин по гео или подтверждение хостом). */
  ATTENDED: 10,
  /** Отмена участия менее чем за LATE_CANCEL_WINDOW_HOURS до старта. */
  LATE_CANCEL: -15,
  /** Молчаливый слив (no-show). */
  NO_SHOW: -30,
} as const;

/** Окно поздней отмены участником, часы до старта. */
export const LATE_CANCEL_WINDOW_HOURS = 2;
/** За сколько часов до старта проверяем кворум и предлагаем хосту снизить порог или отменить. */
export const QUORUM_CHECK_HOURS_BEFORE = 1;
/** Отмена хостом позже этого срока (без недобора) считается host flake. */
export const HOST_LATE_CANCEL_HOURS = 1;
/** Через сколько часов после окончания бот спрашивает хоста, кто пришёл. */
export const ATTENDANCE_POLL_HOURS_AFTER = 2;
/** Лимит создания лобби в сутки для новичков. */
export const NEWBIE_LOBBIES_PER_DAY = 1;
/** Число независимых жалоб для теневого бана до проверки. */
export const SHADOW_BAN_REPORTS = 3;

/** Сколько тегов интересов выбирает пользователь на онбординге. */
export const INTERESTS_MIN = 3;
export const INTERESTS_MAX = 5;

/** Допустимый возраст на онбординге (бары и встречи взрослых: 18+). */
export const AGE_MIN = 18;
export const AGE_MAX = 99;

/** Ограничения на поля лобби. */
export const LOBBY_TITLE_MAX = 80;
export const LOBBY_DESCRIPTION_MAX = 1000;
export const LOBBY_SLOTS_MIN = 1;
export const LOBBY_SLOTS_MAX = 50;
