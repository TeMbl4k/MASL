import {
  type ApplyBlockReason,
  asDate,
  effectiveLobbyStatus,
  HOUR_MS,
  type Instant,
  type KarmaReason,
  type LobbyStatus,
  type MembershipStatus,
  type ModerationAction,
  type ModerationCaseKind,
  type ModerationDecision,
  type PaymentFormat,
  type ReportNotCounted,
  type UserRole,
} from '@masl/shared';
import { formatCountdown } from './datetime.js';

export const KARMA_REASON_LABELS: Readonly<Record<KarmaReason, string>> = {
  attended: 'Пришли на встречу',
  late_cancel: 'Поздняя отмена',
  no_show: 'Не пришли',
  host_late_cancel: 'Поздняя отмена встречи хостом',
  hosted: 'Провели встречу',
  manual: 'Решение модерации',
  moderation: 'Решение модерации',
  appeal_refund: 'Возврат по апелляции',
};

export { LOBBY_CANCEL_REASON_LABELS, REPORT_REASON_LABELS } from '@masl/shared';

/** Moderators only: why a report doesn't count toward the shadow ban. */
export const REPORT_NOT_COUNTED_LABELS: Readonly<Record<ReportNotCounted, string>> = {
  shadow_banned: 'у автора теневой бан',
  new_account: 'аккаунту меньше суток',
  same_reporter: 'тот же человек уже жаловался',
};

export const CASE_KIND_LABELS: Readonly<Record<ModerationCaseKind, string>> = {
  reports: 'Жалобы',
  not_held: 'Не состоялась',
  appeal: 'Апелляция',
};

export const DECISION_LABELS: Readonly<Record<ModerationDecision, string>> = {
  reports_confirmed: 'Нарушение подтверждено',
  reports_dismissed: 'Жалобы не подтвердились',
  meetup_held: 'Встреча состоялась',
  host_flaked: 'Организатор сорвал встречу',
  appeal_approved: 'Блокировка снята',
  appeal_rejected: 'Апелляция отклонена',
};

export const MODERATION_ACTION_LABELS: Readonly<Record<ModerationAction, string>> = {
  auto_shadow_ban: 'Теневой бан: независимые жалобы',
  shadow_ban: 'Теневой бан',
  lift_shadow_ban: 'Теневой бан снят',
  block_creation: 'Запрет создавать встречи',
  unblock_creation: 'Создание встреч разрешено',
  karma_change: 'Карма изменена',
  cancel_lobby: 'Встреча отменена',
  grant_moderator: 'Назначен модератором',
  revoke_moderator: 'Снят с модераторов',
  resolve_case: 'Решение по делу',
};

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  user: 'Пользователь',
  moderator: 'Модератор',
  admin: 'Админ',
};

export const PAYMENT_FORMAT_LABELS: Readonly<Record<PaymentFormat, string>> = {
  free: 'Бесплатно',
  split: 'Делим счёт',
};

/** «Свободно 2 из 4», «Мест нет». */
export function formatSeats(slots: number, approvedCount: number): string {
  const free = Math.max(0, slots - approvedCount);
  return free === 0 ? 'Мест нет' : `Свободно ${free} из ${slots}`;
}

/** «Карма от 60», or null without a threshold. */
export function formatMinKarma(minKarma: number | null): string | null {
  return minKarma === null ? null : `Карма от ${minKarma}`;
}

/** Below this, an open lobby's pill counts down to the start. */
const COUNTDOWN_HOURS = 3;

export type StatusPillTone = 'open' | 'soon' | 'full' | 'active' | 'finished' | 'cancelled';

/**
 * Status pill of a lobby at `now` (spec §9.10): the stored status is effective at read time,
 * so it is re-derived as the clock moves.
 */
export function lobbyStatusPill(
  lobby: { status: LobbyStatus; startsAt: Instant; endsAt: Instant; slots: number; approvedCount: number },
  now: Instant,
): { text: string; tone: StatusPillTone } {
  const status = effectiveLobbyStatus(lobby, now);
  if (status === 'cancelled') return { text: 'Отменена', tone: 'cancelled' };
  if (status === 'finished') return { text: 'Завершена', tone: 'finished' };
  if (status === 'active') return { text: 'Идёт', tone: 'active' };
  if (lobby.approvedCount >= lobby.slots) return { text: 'Состав собран', tone: 'full' };
  const left = asDate(lobby.startsAt).getTime() - asDate(now).getTime();
  const countdown = left <= COUNTDOWN_HOURS * HOUR_MS ? formatCountdown(lobby.startsAt, now) : null;
  return countdown ? { text: countdown, tone: 'soon' } : { text: 'Набор', tone: 'open' };
}

/**
 * The viewer's membership as a badge: «Ожидает подтверждения», «Вы участник», «Заявка отклонена»,
 * «Вы отменили». A cancelled pending application shows nothing: the viewer can apply again.
 */
export function membershipLabel(
  status: MembershipStatus | null,
  applyBlock: ApplyBlockReason | null,
): { text: string; tone: 'pending' | 'member' | 'refused' } | null {
  switch (status) {
    case 'pending':
      return { text: 'Ожидает подтверждения', tone: 'pending' };
    case 'approved':
    case 'attended':
      return { text: 'Вы участник', tone: 'member' };
    case 'rejected':
      return { text: 'Заявка отклонена', tone: 'refused' };
    case 'cancelled':
      return applyBlock === 'left' ? { text: 'Вы отменили', tone: 'refused' } : null;
    default:
      return null;
  }
}
