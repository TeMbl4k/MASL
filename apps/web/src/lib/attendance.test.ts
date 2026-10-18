import type { AttendanceMemberDto } from '@masl/shared';
import { describe, expect, it } from 'vitest';
import { attendanceCounts, canMarkAbsent, initialAbsent } from './attendance.js';

const member = (patch: Partial<AttendanceMemberDto>): AttendanceMemberDto => ({
  applicationId: crypto.randomUUID(),
  user: { firstName: 'Анна', photoUrl: null, karma: 50 },
  checkedInAt: null,
  absent: false,
  status: 'approved',
  ...patch,
});

describe('attendance marks', () => {
  const present = member({});
  const drafted = member({ absent: true });
  const checkedIn = member({ checkedInAt: '2026-10-17T16:24:00.000Z' });

  it('starts from the bot toggles and never marks a checked-in member absent', () => {
    const odd = member({ absent: true, checkedInAt: '2026-10-17T16:20:00.000Z' });
    expect([...initialAbsent([present, drafted, checkedIn, odd])]).toEqual([drafted.applicationId]);
  });

  it('lets the host toggle only open, not checked-in approved members', () => {
    expect(canMarkAbsent(present, 'open')).toBe(true);
    expect(canMarkAbsent(checkedIn, 'open')).toBe(false);
    for (const state of ['not_yet', 'saved', 'closed'] as const) {
      expect(canMarkAbsent(present, state)).toBe(false);
    }
    expect(canMarkAbsent(member({ status: 'attended' }), 'open')).toBe(false);
  });

  it('counts present and absent', () => {
    const members = [present, drafted, checkedIn];
    expect(attendanceCounts(members, new Set([drafted.applicationId]))).toEqual({ present: 2, absent: 1 });
    expect(attendanceCounts(members, new Set())).toEqual({ present: 3, absent: 0 });
  });
});
