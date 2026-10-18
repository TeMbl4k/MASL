import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { lobbies, lobbyMembers, type Database } from '@masl/db';
import {
  ATTENDANCE_CLOSE_HOURS_AFTER,
  ATTENDANCE_POLL_HOURS_AFTER,
  ATTENDANCE_REMINDER_HOURS_AFTER,
  FEEDBACK_MEMBERSHIP_STATUSES,
  HOUR_MS,
  QUORUM_CHECK_HOURS_BEFORE,
} from '@masl/shared';
import { OutboxService, type OutboxMessage } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { formatRedacted, redactError } from '../errors/redacting-exception.filter.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { AttendanceService } from './attendance.service.js';
import { approvedCountSql } from './lobby-queries.js';

/** Next to MIGRATION_LOCK_ID (7_302_514) of packages/db. */
const LOBBY_STATUS_LOCK_ID = 7_302_515;
const SWEEP_INTERVAL_MS = 60_000;

export interface SweepResult {
  started: string[];
  finished: string[];
}

const hoursFrom = (now: Date, hours: number) => new Date(now.getTime() + hours * HOUR_MS);

/** What the attendance steps read back from the lobbies they mark. */
const attendanceStep = {
  id: lobbies.id,
  hostId: lobbies.hostId,
  savedAt: lobbies.attendanceSavedAt,
  approved: approvedCountSql,
};

/** The host is asked only while there is someone to mark and nothing is saved yet. */
const asksHost = (lobby: { savedAt: Date | null; approved: number }) =>
  lobby.savedAt === null && lobby.approved > 0;

/**
 * Persists the time-driven statuses (open → active → finished) by CLOCK, then runs the bot's
 * scheduled steps (stage 3 §8). Every step marks the lobbies it handles in the same UPDATE, so
 * each lobby is handled once, and queues its messages in the same transaction.
 */
@Injectable()
export class LobbyStatusSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('LobbyStatusSweeper');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  onApplicationBootstrap(): void {
    // Tests call sweep() themselves.
    if (this.env.NODE_ENV === 'test') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One scheduled run: a failure is logged in the redacted shape and never thrown. */
  async tick(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.log.error(formatRedacted('обновления статусов встреч', redactError(error)));
    }
  }

  /**
   * Moves statuses under a transaction-level advisory lock (works behind a transaction pooler,
   * unlike a session lock); a concurrent run gets empty lists. Under READ COMMITTED an UPDATE
   * re-checks its WHERE after waiting on a row, so each id is returned once and a lobby
   * cancelled meanwhile no longer matches.
   */
  async sweep(): Promise<SweepResult> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${LOBBY_STATUS_LOCK_ID}) as locked`,
      );
      if (!row?.locked) return { started: [], finished: [] };
      const started = await tx
        .update(lobbies)
        .set({ status: 'active', updatedAt: now })
        .where(and(eq(lobbies.status, 'open'), lte(lobbies.startsAt, now), gt(lobbies.endsAt, now)))
        .returning({ id: lobbies.id });
      const finished = await tx
        .update(lobbies)
        .set({ status: 'finished', updatedAt: now })
        .where(and(inArray(lobbies.status, ['open', 'active']), lte(lobbies.endsAt, now)))
        .returning({ id: lobbies.id });
      await this.outbox.enqueue(tx, await this.scheduled(tx, now), now);
      return { started: started.map((r) => r.id), finished: finished.map((r) => r.id) };
    });
  }

  /** The bot's scheduled steps; returns the messages they queue. */
  private async scheduled(tx: DbTransaction, now: Date): Promise<OutboxMessage[]> {
    const messages: OutboxMessage[] = [];
    const activeChat = (row: { chatId: number | null; chatClosedAt: Date | null }) =>
      row.chatId !== null && row.chatClosedAt === null ? row.chatId : null;

    // Quorum: an hour before the start the host of a lobby that isn't full can lower the
    // threshold or cancel without a penalty. Lobbies created later than that aren't asked.
    const quorum = await tx
      .update(lobbies)
      .set({ quorumCheckedAt: now })
      .where(
        and(
          eq(lobbies.status, 'open'),
          isNull(lobbies.quorumCheckedAt),
          gt(lobbies.startsAt, now),
          lte(lobbies.startsAt, hoursFrom(now, QUORUM_CHECK_HOURS_BEFORE)),
        ),
      )
      .returning({
        id: lobbies.id,
        hostId: lobbies.hostId,
        createdAt: lobbies.createdAt,
        startsAt: lobbies.startsAt,
        slots: lobbies.slots,
        approved: approvedCountSql,
      });
    for (const lobby of quorum) {
      const askedInTime =
        lobby.createdAt.getTime() <= lobby.startsAt.getTime() - QUORUM_CHECK_HOURS_BEFORE * HOUR_MS;
      if (askedInTime && lobby.approved < lobby.slots) {
        messages.push({ kind: 'host_quorum_check', userId: lobby.hostId, lobbyId: lobby.id });
      }
    }
    // Started (or cancelled) before any pass saw it in the window: too late to ask.
    await tx
      .update(lobbies)
      .set({ quorumCheckedAt: now })
      .where(and(isNull(lobbies.quorumCheckedAt), lte(lobbies.startsAt, now)));

    // The end: the group learns it, the invite link stops working.
    const ended = await tx
      .update(lobbies)
      .set({ endedNotifiedAt: now })
      .where(and(eq(lobbies.status, 'finished'), isNull(lobbies.endedNotifiedAt)))
      .returning({ id: lobbies.id, chatId: lobbies.chatId, chatClosedAt: lobbies.chatClosedAt });
    for (const lobby of ended) {
      const chatId = activeChat(lobby);
      if (chatId !== null) messages.push({ kind: 'group_finished', chatId, lobbyId: lobby.id });
    }

    // Attendance: the host's poll and the members' «Как прошла?», a reminder, then the close.
    const polled = await tx
      .update(lobbies)
      .set({ attendanceRequestedAt: now })
      .where(
        and(
          eq(lobbies.status, 'finished'),
          isNull(lobbies.attendanceRequestedAt),
          lte(lobbies.endsAt, hoursFrom(now, -ATTENDANCE_POLL_HOURS_AFTER)),
        ),
      )
      .returning(attendanceStep);
    for (const lobby of polled) {
      if (asksHost(lobby))
        messages.push({ kind: 'host_attendance_poll', userId: lobby.hostId, lobbyId: lobby.id });
    }
    if (polled.length > 0) {
      const raters = await tx
        .select({ id: lobbyMembers.id, userId: lobbyMembers.userId, lobbyId: lobbyMembers.lobbyId })
        .from(lobbyMembers)
        .where(
          and(
            inArray(
              lobbyMembers.lobbyId,
              polled.map((l) => l.id),
            ),
            inArray(lobbyMembers.status, [...FEEDBACK_MEMBERSHIP_STATUSES]),
          ),
        );
      for (const rater of raters) {
        messages.push({
          kind: 'member_feedback_request',
          userId: rater.userId,
          lobbyId: rater.lobbyId,
          memberId: rater.id,
        });
      }
    }
    const reminded = await tx
      .update(lobbies)
      .set({ attendanceRemindedAt: now })
      .where(
        and(
          eq(lobbies.status, 'finished'),
          isNotNull(lobbies.attendanceRequestedAt),
          isNull(lobbies.attendanceRemindedAt),
          lte(lobbies.endsAt, hoursFrom(now, -ATTENDANCE_REMINDER_HOURS_AFTER)),
        ),
      )
      .returning(attendanceStep);
    for (const lobby of reminded) {
      if (asksHost(lobby)) {
        messages.push({ kind: 'host_attendance_reminder', userId: lobby.hostId, lobbyId: lobby.id });
      }
    }
    messages.push(...(await this.attendance.closeExpired(tx, now)));

    // The bot leaves the group when attendance closes, or as long after a cancel.
    const leaving = await tx
      .update(lobbies)
      .set({ chatClosedAt: now })
      .where(
        and(
          isNotNull(lobbies.chatId),
          isNull(lobbies.chatClosedAt),
          or(
            and(
              eq(lobbies.status, 'cancelled'),
              lte(lobbies.cancelledAt, hoursFrom(now, -ATTENDANCE_CLOSE_HOURS_AFTER)),
            ),
            and(
              eq(lobbies.status, 'finished'),
              lte(lobbies.endsAt, hoursFrom(now, -ATTENDANCE_CLOSE_HOURS_AFTER)),
            ),
          ),
        ),
      )
      .returning({ id: lobbies.id, chatId: lobbies.chatId });
    for (const lobby of leaving)
      messages.push({ kind: 'group_leave', chatId: lobby.chatId!, lobbyId: lobby.id });

    return messages;
  }
}
