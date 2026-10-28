import { HttpException, HttpStatus } from '@nestjs/common';
import {
  APPLICATIONS_PENDING_MAX,
  CHECK_IN_OPENS_MINUTES_BEFORE,
  formatRetryAfter,
  HOSTED_UPCOMING_MAX,
  LOBBIES_PER_DAY_MAX,
  CREATION_BLOCKED_APPEAL,
  CREATION_BLOCKED_TITLES,
  PLACE_TOO_FAR_MESSAGE,
  START_ISSUE_MESSAGES,
  type ApiErrorCode,
  type CreationBlockKind,
  type ApiErrorDto,
} from '@masl/shared';

/** Codes whose message needs data; every other code has a constant message. */
interface ApiErrorParams {
  creation_blocked: { kind: CreationBlockKind };
  daily_limit: { newbie: boolean; retryAt: Date; now: Date };
  karma_too_low: { minKarma: number; karma: number };
  appeal_too_soon: { retryAt: Date; now: Date };
}

type ParamsArg<C extends ApiErrorCode> = C extends keyof ApiErrorParams ? [params: ApiErrorParams[C]] : [];

type MessageMap = {
  [C in ApiErrorCode]: C extends keyof ApiErrorParams ? (params: ApiErrorParams[C]) => string : string;
};

export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, HttpStatus>> = {
  not_onboarded: HttpStatus.FORBIDDEN,
  terms_not_accepted: HttpStatus.FORBIDDEN,
  terms_outdated: HttpStatus.CONFLICT,
  creation_blocked: HttpStatus.FORBIDDEN,
  daily_limit: HttpStatus.TOO_MANY_REQUESTS,
  upcoming_limit: HttpStatus.TOO_MANY_REQUESTS,
  starts_too_soon: HttpStatus.BAD_REQUEST,
  starts_too_far: HttpStatus.BAD_REQUEST,
  place_too_far: HttpStatus.BAD_REQUEST,
  lobby_not_found: HttpStatus.NOT_FOUND,
  not_host: HttpStatus.FORBIDDEN,
  lobby_cancelled: HttpStatus.CONFLICT,
  lobby_closed: HttpStatus.CONFLICT,
  lobby_started: HttpStatus.CONFLICT,
  lobby_full: HttpStatus.CONFLICT,
  karma_too_low: HttpStatus.FORBIDDEN,
  own_lobby: HttpStatus.CONFLICT,
  application_rejected: HttpStatus.CONFLICT,
  application_left: HttpStatus.CONFLICT,
  pending_limit: HttpStatus.TOO_MANY_REQUESTS,
  applications_daily_limit: HttpStatus.TOO_MANY_REQUESTS,
  application_not_found: HttpStatus.NOT_FOUND,
  application_not_pending: HttpStatus.CONFLICT,
  applicant_karma_too_low: HttpStatus.CONFLICT,
  invalid_cursor: HttpStatus.BAD_REQUEST,
  chat_already_linked: HttpStatus.CONFLICT,
  bot_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  check_in_not_open: HttpStatus.CONFLICT,
  check_in_closed: HttpStatus.CONFLICT,
  check_in_too_far: HttpStatus.CONFLICT,
  attendance_not_open: HttpStatus.CONFLICT,
  attendance_closed: HttpStatus.CONFLICT,
  attendance_saved: HttpStatus.CONFLICT,
  checked_in_member: HttpStatus.BAD_REQUEST,
  report_own_lobby: HttpStatus.BAD_REQUEST,
  reports_daily_limit: HttpStatus.TOO_MANY_REQUESTS,
  not_blocked: HttpStatus.CONFLICT,
  appeal_open: HttpStatus.CONFLICT,
  appeal_too_soon: HttpStatus.TOO_MANY_REQUESTS,
  forbidden_moderation: HttpStatus.FORBIDDEN,
  case_not_found: HttpStatus.NOT_FOUND,
  case_resolved: HttpStatus.CONFLICT,
  decision_mismatch: HttpStatus.BAD_REQUEST,
  user_not_found: HttpStatus.NOT_FOUND,
  self_moderation: HttpStatus.FORBIDDEN,
  admin_only: HttpStatus.FORBIDDEN,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  conflict: HttpStatus.CONFLICT,
  invalid_data: HttpStatus.BAD_REQUEST,
  retry: HttpStatus.CONFLICT,
  internal_error: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * The single Russian message of each code. Messages never carry an address, coordinates or
 * another user's data; only the viewer's own karma and limits.
 */
const MESSAGES: MessageMap = {
  not_onboarded: 'Сначала заполните профиль',
  terms_not_accepted: 'Сначала примите пользовательское соглашение',
  terms_outdated: 'Соглашение обновилось. Откройте приложение заново, чтобы прочитать новую версию',
  creation_blocked: ({ kind }) => `${CREATION_BLOCKED_TITLES[kind]}. ${CREATION_BLOCKED_APPEAL}`,
  daily_limit: ({ newbie, retryAt, now }) =>
    newbie
      ? `Новичкам доступна одна встреча в сутки. Следующую можно создать ${formatRetryAfter(retryAt, now)}`
      : `Можно создавать не больше ${LOBBIES_PER_DAY_MAX} встреч в сутки. Следующую — ${formatRetryAfter(retryAt, now)}`,
  upcoming_limit: `У вас уже ${HOSTED_UPCOMING_MAX} предстоящих встреч. Дождитесь их или отмените одну`,
  starts_too_soon: START_ISSUE_MESSAGES.starts_too_soon,
  starts_too_far: START_ISSUE_MESSAGES.starts_too_far,
  place_too_far: PLACE_TOO_FAR_MESSAGE,
  lobby_not_found: 'Встреча не найдена',
  not_host: 'Управлять встречей может только хост',
  lobby_cancelled: 'Встреча отменена',
  lobby_closed: 'Набор на встречу закрыт',
  lobby_started: 'Встреча уже началась',
  lobby_full: 'Все места заняты',
  karma_too_low: ({ minKarma, karma }) => `Нужна карма от ${minKarma}. У вас ${karma}`,
  own_lobby: 'Это ваша встреча',
  application_rejected: 'Хост уже отклонил вашу заявку',
  application_left: 'Вы отменили участие — подать заявку снова нельзя',
  pending_limit: `У вас уже ${APPLICATIONS_PENDING_MAX} заявок на рассмотрении. Дождитесь ответов или отмените лишние`,
  applications_daily_limit: 'Слишком много заявок за сутки. Попробуйте завтра',
  application_not_found: 'Заявка не найдена',
  application_not_pending: 'Заявка уже рассмотрена или отменена',
  applicant_karma_too_low: 'Карма участника ниже порога встречи',
  invalid_cursor: 'Список устарел — обновите ленту',
  chat_already_linked: 'У встречи уже есть чат',
  bot_unavailable:
    'Не получилось связаться с Telegram. Откройте чат с ботом, нажмите «Старт» и попробуйте ещё раз',
  check_in_not_open: `Отметиться можно за ${CHECK_IN_OPENS_MINUTES_BEFORE} минут до начала`,
  check_in_closed: 'Отметиться уже нельзя',
  check_in_too_far: 'Вы далеко от места встречи. Подойдите ближе и попробуйте ещё раз',
  attendance_not_open: 'Отметить, кто пришёл, можно после окончания встречи',
  attendance_closed: 'Время отметить, кто пришёл, вышло',
  attendance_saved: 'Вы уже отметили, кто пришёл',
  checked_in_member: 'Нельзя отметить отсутствие того, кто отметился на месте',
  report_own_lobby: 'На свою встречу пожаловаться нельзя',
  reports_daily_limit: 'Слишком много жалоб за сутки. Попробуйте завтра',
  not_blocked: 'Создание встреч не заблокировано, обжаловать нечего',
  appeal_open: 'Апелляция уже на рассмотрении. Ответ придёт в бот',
  appeal_too_soon: ({ retryAt, now }) => `Новую апелляцию можно подать ${formatRetryAfter(retryAt, now)}`,
  forbidden_moderation: 'Раздел только для модераторов',
  case_not_found: 'Дело не найдено',
  case_resolved: 'Дело уже решено',
  decision_mismatch: 'Это решение не подходит к делу',
  user_not_found: 'Пользователь не найден',
  self_moderation: 'Решения о себе принимает другой модератор',
  admin_only: 'Назначать модераторов может только админ',
  rate_limited: 'Слишком много запросов. Подождите немного',
  conflict: 'Данные изменились, попробуйте ещё раз',
  invalid_data: 'Некорректные данные',
  retry: 'Попробуйте ещё раз',
  internal_error: 'Внутренняя ошибка сервера',
};

/** Input field each validation-like code points at, for the form to highlight. */
const ISSUE_PATHS: Partial<Record<ApiErrorCode, string>> = {
  starts_too_soon: 'startsAt',
  starts_too_far: 'startsAt',
  place_too_far: 'location',
};

/** An HttpException whose response is an `apiErrorDto` body. */
export class ApiException extends HttpException {
  constructor(readonly body: ApiErrorDto) {
    super(body, body.statusCode);
  }
}

/** The only way the API builds an error body with a `code`. */
export function apiError<C extends ApiErrorCode>(code: C, ...[params]: ParamsArg<C>): ApiException {
  const entry = MESSAGES[code] as string | ((p: NonNullable<typeof params>) => string);
  const message = typeof entry === 'function' ? entry(params!) : entry;
  const body: ApiErrorDto = { statusCode: API_ERROR_STATUS[code], code, message };
  if (code === 'daily_limit' || code === 'appeal_too_soon') {
    body.retryAt = (params as { retryAt: Date }).retryAt.toISOString();
  }
  const path = ISSUE_PATHS[code];
  if (path) {
    body.issues = [{ path, message }];
  }
  return new ApiException(body);
}
