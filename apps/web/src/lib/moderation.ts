import {
  asDate,
  DAY_MS,
  formatMoscow,
  formatMoscowTime,
  HOUR_MS,
  KARMA,
  type AdminCaseSummaryDto,
  type AdminLobbyDto,
  type AdminMemberDto,
  type CreationBlockDto,
  type CreationBlockKind,
  type FeedbackRating,
  type Instant,
  type ModerationLogEntryDto,
} from '@masl/shared';
import { formatKarmaDelta } from '#lib/components/KarmaCard.svelte';
import { DECISION_LABELS, MODERATION_ACTION_LABELS, REPORT_REASON_LABELS } from '#lib/format/labels.js';
import { plural, type PluralForms } from '#lib/format/plural.js';

/** Texts about moderation: the moderator screens and the blocked user's own card. */

const REPORT_FORMS: PluralForms = ['жалоба', 'жалобы', 'жалоб'];
const DAY_FORMS: PluralForms = ['день', 'дня', 'дней'];
const YEAR_FORMS: PluralForms = ['год', 'года', 'лет'];
const MEMBER_FORMS: PluralForms = ['участник', 'участника', 'участников'];

export const BLOCK_KIND_SHORT: Readonly<Record<CreationBlockKind, string>> = {
  late_cancel: 'Блокировка после отмены в последний час',
  moderation: 'Блокировка решением модерации',
};

export const FEEDBACK_LABELS: Readonly<Record<FeedbackRating, string>> = {
  good: 'Хорошо',
  bad: 'Плохо',
  not_held: 'Не состоялась',
};

/** A member's attendance as the host marked it: «на встрече, +10», «не было, −30». */
export function memberMark(member: AdminMemberDto): string {
  const karma = member.karmaDelta === null ? '' : `, ${formatKarmaDelta(member.karmaDelta)}`;
  if (member.status === 'attended') return `на встрече${karma}`;
  if (member.status === 'no_show') return `не было${karma}`;
  return 'без отметки';
}

/** «17 октября». */
export const formatDay = (at: Instant): string => formatMoscow(at, { day: 'numeric', month: 'long' });

/** What caused a creation block: «"Падел" отменена 17 октября. −30 кармы.»; null without a lobby. */
export function blockCause(block: CreationBlockDto): string | null {
  if (!block.lobby) return null;
  const when = block.lobby.cancelledAt
    ? `отменена ${formatDay(block.lobby.cancelledAt)}`
    : formatDay(block.lobby.startsAt);
  const karma = block.karmaDelta ? ` ${formatKarmaDelta(block.karmaDelta)} кармы.` : '';
  return `«${block.lobby.title}» ${when}.${karma}`;
}

/** How long the account exists: «5 ч», «3 дня», «2 нед.», «4 мес.», «2 года». */
export function accountAge(joinedAt: Instant, now: Instant): string {
  const age = Math.max(0, asDate(now).getTime() - asDate(joinedAt).getTime());
  const days = Math.floor(age / DAY_MS);
  if (days < 1) return `${Math.max(1, Math.floor(age / HOUR_MS))} ч`;
  if (days < 14) return plural(days, DAY_FORMS);
  if (days < 60) return `${Math.floor(days / 7)} нед.`;
  if (days < 365) return `${Math.floor(days / 30)} мес.`;
  return plural(Math.floor(days / 365), YEAR_FORMS);
}

/** «4 жалобы, учтено 3»; «2 жалобы» when every one counts. */
export function reportsCount(total: number, counted: number): string {
  const all = plural(total, REPORT_FORMS);
  return counted === total ? all : `${all}, учтено ${counted}`;
}

/** The queue row's middle line. */
export function caseSummary(item: AdminCaseSummaryDto): string {
  if (item.kind === 'reports' && item.reports) {
    const reasons = item.reports.reasons.map((reason) => REPORT_REASON_LABELS[reason].toLowerCase());
    return [reportsCount(item.reports.total, item.reports.counted), reasons.join(', ')]
      .filter(Boolean)
      .join(' · ');
  }
  if (item.kind === 'appeal') return item.blockKind ? BLOCK_KIND_SHORT[item.blockKind] : 'Апелляция';
  const answers = item.notHeld ?? 0;
  const who = `${plural(answers, MEMBER_FORMS)} ${answers === 1 ? 'ответил' : 'ответили'} «Не состоялась»`;
  return item.lobby ? `«${item.lobby.title}»: ${who}` : who;
}

/** «Организатор сорвал встречу»: what the decision does, as the API applies it. */
export function flakeConsequences(lobby: AdminLobbyDto): string {
  const host = KARMA.HOST_LATE_CANCEL - (lobby.hostedDelta ?? 0);
  const noShows = lobby.members.filter((member) => member.status === 'no_show');
  const refund =
    noShows.length > 0
      ? ` Неявку снимем: ${noShows.map((member) => member.user.firstName).join(', ')} (${formatKarmaDelta(Math.abs(KARMA.NO_SHOW))}).`
      : '';
  return `Организатору ${formatKarmaDelta(host)} кармы и запрет создавать встречи.${refund}`;
}

/** «18 октября, 15:02». */
export function formatLogTime(at: Instant): string {
  return `${formatDay(at)}, ${formatMoscowTime(at)}`;
}

/** What a log entry did: «Нарушение подтверждено», «Карма изменена: −20». */
export function historyTitle(entry: ModerationLogEntryDto): string {
  if (entry.action === 'resolve_case' && entry.decision) return DECISION_LABELS[entry.decision];
  const label = MODERATION_ACTION_LABELS[entry.action];
  return entry.karmaDelta === null ? label : `${label}: ${formatKarmaDelta(entry.karmaDelta)}`;
}
