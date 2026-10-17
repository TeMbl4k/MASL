import { MEMBERSHIP_STATUSES, type MembershipStatus } from '@masl/shared';
import { describe, expect, it } from 'vitest';
import { formatMinKarma, formatSeats, membershipLabel } from './labels.js';

describe('membershipLabel', () => {
  const expected: Record<MembershipStatus, string | null> = {
    pending: 'Ожидает подтверждения',
    approved: 'Вы участник',
    attended: 'Вы участник',
    rejected: 'Заявка отклонена',
    // A cancelled pending application: the viewer can apply again, so there is no badge.
    cancelled: null,
    no_show: null,
  };

  it.each(MEMBERSHIP_STATUSES)('labels %s without an apply block', (status) => {
    expect(membershipLabel(status, null)?.text ?? null).toBe(expected[status]);
  });

  it('marks a place the viewer gave up', () => {
    expect(membershipLabel('cancelled', 'left')).toEqual({ text: 'Вы отменили', tone: 'refused' });
  });

  it('ignores the apply block for every other status', () => {
    for (const status of MEMBERSHIP_STATUSES.filter((s) => s !== 'cancelled')) {
      expect(membershipLabel(status, 'left')).toEqual(membershipLabel(status, null));
    }
  });

  it('gives tones by outcome and nothing without a membership', () => {
    expect(membershipLabel('pending', null)?.tone).toBe('pending');
    expect(membershipLabel('approved', null)?.tone).toBe('member');
    expect(membershipLabel('rejected', 'rejected')?.tone).toBe('refused');
    expect(membershipLabel(null, null)).toBeNull();
    expect(membershipLabel(null, 'karma')).toBeNull();
  });
});

describe('formatSeats', () => {
  it('shows the free seats', () => {
    expect(formatSeats(4, 2)).toBe('Свободно 2 из 4');
    expect(formatSeats(4, 0)).toBe('Свободно 4 из 4');
  });

  it('says there are no seats when full or over-full', () => {
    expect(formatSeats(4, 4)).toBe('Мест нет');
    expect(formatSeats(4, 5)).toBe('Мест нет');
  });
});

describe('formatMinKarma', () => {
  it('formats the threshold, or nothing without one', () => {
    expect(formatMinKarma(60)).toBe('Карма от 60');
    expect(formatMinKarma(0)).toBe('Карма от 0');
    expect(formatMinKarma(null)).toBeNull();
  });
});
