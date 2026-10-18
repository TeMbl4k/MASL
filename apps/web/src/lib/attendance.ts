import type { AttendanceMemberDto, AttendanceState } from '@masl/shared';

/** A member the host can still mark absent: not checked in, attendance open, not saved. */
export function canMarkAbsent(member: AttendanceMemberDto, state: AttendanceState): boolean {
  return state === 'open' && member.status === 'approved' && member.checkedInAt === null;
}

/** The marks the screen starts from: the host's toggles in the bot, never a checked-in member. */
export function initialAbsent(members: readonly AttendanceMemberDto[]): Set<string> {
  return new Set(members.filter((m) => m.absent && m.checkedInAt === null).map((m) => m.applicationId));
}

/** Who counts as present and absent with these marks. */
export function attendanceCounts(
  members: readonly AttendanceMemberDto[],
  absent: ReadonlySet<string>,
): { present: number; absent: number } {
  const missing = members.filter((m) => absent.has(m.applicationId)).length;
  return { present: members.length - missing, absent: missing };
}
