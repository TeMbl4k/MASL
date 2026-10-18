import { notCountedReason } from './reports.service.js';

const now = new Date('2026-10-18T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3_600_000);

describe('notCountedReason', () => {
  const counted = { isShadowBanned: false, createdAt: daysAgo(30), reportedInCase: false };

  it('counts an old, unbanned reporter new to the case', () => {
    expect(notCountedReason(counted, now)).toBeNull();
  });

  it('checks the ban, then the account age, then a repeat in the case', () => {
    expect(notCountedReason({ ...counted, createdAt: daysAgo(0.99) }, now)).toBe('new_account');
    expect(notCountedReason({ ...counted, createdAt: daysAgo(1) }, now)).toBeNull();
    expect(notCountedReason({ ...counted, reportedInCase: true }, now)).toBe('same_reporter');
    expect(notCountedReason({ isShadowBanned: true, createdAt: daysAgo(0), reportedInCase: true }, now)).toBe(
      'shadow_banned',
    );
    expect(notCountedReason({ ...counted, createdAt: daysAgo(0), reportedInCase: true }, now)).toBe(
      'new_account',
    );
  });
});
