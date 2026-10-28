import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { lobbies, lobbyMembers, users, withinMeters, type Database, type GeoPoint } from '@masl/db';
import {
  ATTENDANCE_CLOSE_HOURS_AFTER,
  CHECK_IN_RADIUS_M,
  HOUR_MS,
  KARMA,
  OCCUPYING_MEMBERSHIP_STATUSES,
  attendanceDeadline,
  attendanceState,
  checkInWindow,
  type AttendanceResponse,
  type LobbyDetailDto,
} from '@masl/shared';
import { AchievementsService } from '../achievements/achievements.service.js';
import { loadPollMembers, type AttendancePollMember } from '../bot/outbox.renderer.js';
import { OutboxService, type OutboxMessage } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { KarmaService, type DbTransaction } from '../karma/karma.service.js';
import { LobbiesService } from './lobbies.service.js';
import { toLobbyCard, toPerson } from './lobby.mapper.js';
import { lockLobby, lockOwnMembership, personColumns, type Executor } from './lobby-queries.js';

/**
 * «Я на месте» and the host's attendance marks (stage 3 §11). Locks follow the global order
 * user → lobby → membership → karma.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(KarmaService) private readonly karma: KarmaService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(AchievementsService) private readonly achievements: AchievementsService,
  ) {}

  /**
   * An approved member marks being at the place: within CHECK_IN_RADIUS_M of the exact point,
   * from CHECK_IN_OPENS_MINUTES_BEFORE before the start until the end. The point is never
   * stored, and a refusal never says how far it is. A repeat keeps the first mark.
   */
  async checkIn(userId: string, lobbyId: string, point: GeoPoint): Promise<LobbyDetailDto> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
      const { row, rights, effectiveStatus } = await this.lobbies.visibleLobby(tx, lobbyId, userId, now);
      const membership = await lockOwnMembership(tx, lobbyId, userId);
      if (effectiveStatus === 'cancelled') throw apiError('lobby_cancelled');
      if (rights.isHost || membership?.status !== 'approved') throw apiError('check_in_closed');
      if (membership.checkedInAt === null) {
        const window = checkInWindow(row, now);
        if (window === 'not_open') throw apiError('check_in_not_open');
        if (window === 'closed') throw apiError('check_in_closed');
        const [near] = await tx
          .select({ id: lobbies.id })
          .from(lobbies)
          .where(and(eq(lobbies.id, lobbyId), withinMeters(lobbies.location, point, CHECK_IN_RADIUS_M)));
        if (!near) throw apiError('check_in_too_far');
        await tx
          .update(lobbyMembers)
          .set({ checkedInAt: now, updatedAt: now })
          .where(eq(lobbyMembers.id, membership.id));
      }
      return this.lobbies.detailFor(tx, { lobbyId, viewerId: userId, now });
    });
  }

  /** The host's attendance list; 403 for anyone else. */
  async view(hostId: string, lobbyId: string): Promise<AttendanceResponse> {
    const now = this.clock.now();
    const { rights } = await this.lobbies.visibleLobby(this.db, lobbyId, hostId, now);
    if (!rights.isHost) throw apiError('not_host');
    return this.attendanceOf(this.db, lobbyId, hostId, now);
  }

  /** The app's save: the listed approved members were absent, everyone else attended. */
  async save(hostId: string, lobbyId: string, absentIds: readonly string[]): Promise<AttendanceResponse> {
    return this.saveWith(hostId, lobbyId, () => absentIds);
  }

  /** The bot's save: the host's toggles in the poll are the absent list. */
  async saveDrafts(hostId: string, lobbyId: string): Promise<AttendanceResponse> {
    return this.saveWith(hostId, lobbyId, (members) =>
      members.filter((m) => m.attendanceAbsentDraft && m.checkedInAt === null).map((m) => m.id),
    );
  }

  /**
   * One toggle of the bot's poll by the host. A checked-in member can't be marked absent:
   * `changed` is false then. Returns the poll as it is now.
   */
  async toggleDraft(
    hostId: string,
    memberId: string,
  ): Promise<{ lobbyId: string; members: AttendancePollMember[]; changed: boolean }> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ lobbyId: lobbyMembers.lobbyId })
        .from(lobbyMembers)
        .where(eq(lobbyMembers.id, memberId));
      if (!target || !(await lockLobby(tx, target.lobbyId))) throw apiError('application_not_found');
      const lobbyId = target.lobbyId;
      await this.openForHost(tx, hostId, lobbyId, now);
      const [member] = await tx
        .select({
          status: lobbyMembers.status,
          checkedInAt: lobbyMembers.checkedInAt,
          absent: lobbyMembers.attendanceAbsentDraft,
        })
        .from(lobbyMembers)
        .where(eq(lobbyMembers.id, memberId))
        .for('no key update');
      if (member?.status !== 'approved') throw apiError('application_not_found');
      const changed = member.checkedInAt === null;
      if (changed) {
        await tx
          .update(lobbyMembers)
          .set({ attendanceAbsentDraft: !member.absent, updatedAt: now })
          .where(eq(lobbyMembers.id, memberId));
      }
      return { lobbyId, members: await loadPollMembers(tx, lobbyId), changed };
    });
  }

  /**
   * The scheduler's close, ATTENDANCE_CLOSE_HOURS_AFTER after the end. When the host never
   * saved, members who checked in count as attended; the rest get nothing, nor does the host's
   * karma (their achievements still count the meetup as held).
   */
  async closeExpired(tx: DbTransaction, now: Date): Promise<OutboxMessage[]> {
    const closed = await tx
      .update(lobbies)
      .set({ attendanceClosedAt: now })
      .where(
        and(
          eq(lobbies.status, 'finished'),
          isNull(lobbies.attendanceClosedAt),
          lte(lobbies.endsAt, new Date(now.getTime() - ATTENDANCE_CLOSE_HOURS_AFTER * HOUR_MS)),
        ),
      )
      .returning({ id: lobbies.id, hostId: lobbies.hostId, savedAt: lobbies.attendanceSavedAt });
    const messages: OutboxMessage[] = [];
    for (const lobby of closed) {
      if (lobby.savedAt !== null) continue;
      const checkedIn = await tx
        .select({ id: lobbyMembers.id, userId: lobbyMembers.userId, checkedInAt: lobbyMembers.checkedInAt })
        .from(lobbyMembers)
        .where(
          and(
            eq(lobbyMembers.lobbyId, lobby.id),
            eq(lobbyMembers.status, 'approved'),
            isNotNull(lobbyMembers.checkedInAt),
          ),
        )
        .orderBy(asc(lobbyMembers.id))
        .for('no key update');
      for (const member of checkedIn) {
        messages.push(...(await this.mark(tx, lobby.id, member, false, now)));
      }
      const attended = checkedIn.map((m) => ({ memberId: m.id, userId: m.userId }));
      messages.push(...(await this.achievements.afterAttendance(tx, lobby.id, lobby.hostId, attended, now)));
    }
    return messages;
  }

  private async saveWith(
    hostId: string,
    lobbyId: string,
    absentOf: (members: LockedMember[]) => readonly string[],
  ): Promise<AttendanceResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      await this.lobbies.lockActor(tx, hostId);
      if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
      await this.openForHost(tx, hostId, lobbyId, now);
      const members: LockedMember[] = await tx
        .select({
          id: lobbyMembers.id,
          userId: lobbyMembers.userId,
          checkedInAt: lobbyMembers.checkedInAt,
          attendanceAbsentDraft: lobbyMembers.attendanceAbsentDraft,
        })
        .from(lobbyMembers)
        .where(and(eq(lobbyMembers.lobbyId, lobbyId), eq(lobbyMembers.status, 'approved')))
        .orderBy(asc(lobbyMembers.id))
        .for('no key update');
      const absent = new Set(absentOf(members));
      for (const id of absent) {
        const member = members.find((m) => m.id === id);
        if (!member) throw apiError('invalid_data');
        if (member.checkedInAt !== null) throw apiError('checked_in_member');
      }

      const messages: OutboxMessage[] = [];
      for (const member of members) {
        messages.push(...(await this.mark(tx, lobbyId, member, absent.has(member.id), now)));
      }
      const attended = members
        .filter((m) => !absent.has(m.id))
        .map((m) => ({ memberId: m.id, userId: m.userId }));
      if (attended.length > 0) {
        await this.karma.apply(tx, {
          userId: hostId,
          lobbyId,
          reason: 'hosted',
          delta: KARMA.HOSTED,
          now,
        });
      }
      await tx.update(lobbies).set({ attendanceSavedAt: now, updatedAt: now }).where(eq(lobbies.id, lobbyId));
      messages.push(...(await this.achievements.afterAttendance(tx, lobbyId, hostId, attended, now)));
      await this.outbox.enqueue(tx, messages, now);
      return this.attendanceOf(tx, lobbyId, hostId, now);
    });
  }

  /** Sets one member's result with its karma; returns the message that tells them. */
  private async mark(
    tx: DbTransaction,
    lobbyId: string,
    member: { id: string; userId: string },
    absent: boolean,
    now: Date,
  ): Promise<OutboxMessage[]> {
    await tx
      .update(lobbyMembers)
      .set({ status: absent ? 'no_show' : 'attended', updatedAt: now })
      .where(eq(lobbyMembers.id, member.id));
    await this.karma.apply(tx, {
      userId: member.userId,
      lobbyId,
      reason: absent ? 'no_show' : 'attended',
      delta: absent ? KARMA.NO_SHOW : KARMA.ATTENDED,
      now,
    });
    return [{ kind: 'member_attendance_result', userId: member.userId, lobbyId, memberId: member.id }];
  }

  /** The host's lobby with attendance open for marks, under the caller's lobby lock. */
  private async openForHost(tx: DbTransaction, hostId: string, lobbyId: string, now: Date): Promise<void> {
    const { row, rights, effectiveStatus } = await this.lobbies.visibleLobby(tx, lobbyId, hostId, now);
    if (!rights.isHost) throw apiError('not_host');
    const [marks] = await tx
      .select({
        attendanceSavedAt: lobbies.attendanceSavedAt,
        attendanceClosedAt: lobbies.attendanceClosedAt,
      })
      .from(lobbies)
      .where(eq(lobbies.id, lobbyId));
    const state = attendanceState({ status: effectiveStatus, endsAt: row.endsAt, ...marks! }, now);
    if (state === 'not_yet') throw apiError('attendance_not_open');
    if (state === 'saved') throw apiError('attendance_saved');
    if (state === 'closed') throw apiError('attendance_closed');
  }

  private async attendanceOf(
    db: Executor,
    lobbyId: string,
    hostId: string,
    now: Date,
  ): Promise<AttendanceResponse> {
    const { row } = await this.lobbies.visibleLobby(db, lobbyId, hostId, now);
    const viewer = await this.lobbies.viewer(db, hostId, now);
    const card = toLobbyCard(row, viewer, now);
    const [marks] = await db
      .select({
        attendanceSavedAt: lobbies.attendanceSavedAt,
        attendanceClosedAt: lobbies.attendanceClosedAt,
      })
      .from(lobbies)
      .where(eq(lobbies.id, lobbyId));
    const members = await db
      .select({
        id: lobbyMembers.id,
        status: lobbyMembers.status,
        checkedInAt: lobbyMembers.checkedInAt,
        absentDraft: lobbyMembers.attendanceAbsentDraft,
        ...personColumns,
      })
      .from(lobbyMembers)
      .innerJoin(users, eq(users.id, lobbyMembers.userId))
      .where(
        and(
          eq(lobbyMembers.lobbyId, lobbyId),
          inArray(lobbyMembers.status, [...OCCUPYING_MEMBERSHIP_STATUSES]),
        ),
      )
      .orderBy(asc(lobbyMembers.decidedAt), asc(lobbyMembers.id));
    return {
      lobby: card,
      state: attendanceState({ status: card.status, endsAt: row.endsAt, ...marks! }, now),
      opensAt: row.endsAt.toISOString(),
      deadline: attendanceDeadline(row.endsAt).toISOString(),
      members: members.map((m) => ({
        applicationId: m.id,
        user: toPerson(m),
        checkedInAt: m.checkedInAt?.toISOString() ?? null,
        absent:
          m.status === 'no_show' || (m.status === 'approved' && m.absentDraft && m.checkedInAt === null),
        status: m.status,
      })),
    };
  }
}

interface LockedMember {
  id: string;
  userId: string;
  checkedInAt: Date | null;
  attendanceAbsentDraft: boolean;
}
