import { adminLobbyDto, type AdminCaseSummaryDto, type AdminMemberDto } from '@masl/shared';
import { describe, expect, it } from 'vitest';
import {
  accountAge,
  caseSummary,
  flakeConsequences,
  historyTitle,
  memberMark,
  reportsCount,
} from './moderation.js';

const NOW = '2026-10-18T12:00:00.000Z';
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('accountAge', () => {
  it.each([
    [ago(5 * HOUR), '5 ч'],
    [ago(10_000), '1 ч'],
    [ago(DAY), '1 день'],
    [ago(3 * DAY), '3 дня'],
    [ago(13 * DAY), '13 дней'],
    [ago(15 * DAY), '2 нед.'],
    [ago(120 * DAY), '4 мес.'],
    [ago(800 * DAY), '2 года'],
  ])('%s → %s', (joinedAt, expected) => {
    expect(accountAge(joinedAt, NOW)).toBe(expected);
  });
});

const summary = (patch: Partial<AdminCaseSummaryDto>): AdminCaseSummaryDto => ({
  id: crypto.randomUUID(),
  kind: 'reports',
  openedAt: NOW,
  subject: { id: crypto.randomUUID(), firstName: 'Олег', karma: 52 },
  shadowBannedAt: null,
  lobby: null,
  reports: null,
  notHeld: null,
  blockKind: null,
  ...patch,
});

describe('caseSummary', () => {
  it('counts reports and names the reasons', () => {
    expect(reportsCount(2, 2)).toBe('2 жалобы');
    expect(caseSummary(summary({ reports: { total: 4, counted: 3, reasons: ['scam', 'promo'] } }))).toBe(
      '4 жалобы, учтено 3 · мошенничество, реклама или промо',
    );
  });

  it('names the block of an appeal and the answers of a not_held case', () => {
    expect(caseSummary(summary({ kind: 'appeal', blockKind: 'late_cancel' }))).toBe(
      'Блокировка после отмены в последний час',
    );
    const lobby = { id: crypto.randomUUID(), title: 'Настолки' };
    expect(caseSummary(summary({ kind: 'not_held', notHeld: 1, lobby }))).toBe(
      '«Настолки»: 1 участник ответил «Не состоялась»',
    );
    expect(caseSummary(summary({ kind: 'not_held', notHeld: 2, lobby }))).toBe(
      '«Настолки»: 2 участника ответили «Не состоялась»',
    );
  });
});

describe('flakeConsequences', () => {
  const member = (firstName: string, status: AdminMemberDto['status']): AdminMemberDto => ({
    user: { id: crypto.randomUUID(), firstName, karma: 50 },
    status,
    checkedInAt: null,
    feedback: null,
    karmaDelta: null,
  });
  const lobby = (hostedDelta: number | null, members: AdminMemberDto[]) =>
    adminLobbyDto.parse({
      id: crypto.randomUUID(),
      title: 'Настолки',
      description: null,
      category: 'boardgames',
      startsAt: ago(DAY),
      endsAt: ago(DAY - 3 * HOUR),
      status: 'finished',
      placeHint: 'м. Китай-город',
      slots: 3,
      approvedCount: members.length,
      cancelReason: null,
      cancelledAt: null,
      attendanceSavedAt: ago(DAY / 2),
      hostedDelta,
      members,
    });

  it('takes the hosted award back and lifts the no-shows', () => {
    expect(flakeConsequences(lobby(10, [member('Лена', 'no_show'), member('Артур', 'attended')]))).toBe(
      'Организатору −40 кармы и запрет создавать встречи. Неявку снимем: Лена (+30).',
    );
    expect(flakeConsequences(lobby(null, [member('Артур', 'attended')]))).toBe(
      'Организатору −30 кармы и запрет создавать встречи.',
    );
  });

  it("marks members by the host's attendance", () => {
    expect(memberMark({ ...member('Лена', 'no_show'), karmaDelta: -30 })).toBe('не было, −30');
    expect(memberMark({ ...member('Артур', 'attended'), karmaDelta: 10 })).toBe('на встрече, +10');
    expect(memberMark(member('Вика', 'approved'))).toBe('без отметки');
  });
});

describe('historyTitle', () => {
  const entry = {
    id: 1,
    createdAt: NOW,
    actor: null,
    karmaDelta: null,
    comment: null,
    decision: null,
    caseId: null,
    lobby: null,
  };

  it('shows the decision of a case and the karma of a change', () => {
    expect(historyTitle({ ...entry, action: 'resolve_case', decision: 'reports_confirmed' })).toBe(
      'Нарушение подтверждено',
    );
    expect(historyTitle({ ...entry, action: 'karma_change', karmaDelta: -20 })).toBe('Карма изменена: −20');
    expect(historyTitle({ ...entry, action: 'auto_shadow_ban' })).toBe('Теневой бан: независимые жалобы');
  });
});
