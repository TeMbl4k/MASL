import { Inject, Injectable } from '@nestjs/common';
import { and, count, countDistinct, eq, gt, isNull, sql } from 'drizzle-orm';
import { lobbies, moderationCases, reports, users, type Database } from '@masl/db';
import {
  HOUR_MS,
  REPORTER_MIN_ACCOUNT_AGE_HOURS,
  REPORTS_PER_DAY_MAX,
  REPORTS_WINDOW_HOURS,
  SHADOW_BAN_REPORTS,
  type ReportInput,
  type ReportNotCounted,
  type ReportResponse,
} from '@masl/shared';
import { OutboxService } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { LobbiesService } from '../lobbies/lobbies.service.js';
import { lockUser } from '../lobbies/lobby-queries.js';
import { logModeration } from './moderation-log.js';
import { notifyModerators } from './notify.js';

/** What decides whether a report counts toward the shadow ban. */
export interface ReporterFacts {
  isShadowBanned: boolean;
  createdAt: Date;
  /** The reporter already reported another lobby of the same host in this case. */
  reportedInCase: boolean;
}

/** Why a report doesn't count, in REPORT_NOT_COUNTED order; null when it counts. */
export function notCountedReason(reporter: ReporterFacts, now: Date): ReportNotCounted | null {
  if (reporter.isShadowBanned) return 'shadow_banned';
  if (now.getTime() - reporter.createdAt.getTime() < REPORTER_MIN_ACCOUNT_AGE_HOURS * HOUR_MS) {
    return 'new_account';
  }
  if (reporter.reportedInCase) return 'same_reporter';
  return null;
}

/**
 * «Пожаловаться» on a lobby (spec stage 4 §2.1). The report joins the host's open reports case;
 * the third independent reporter shadow-bans the host pending a moderator's decision.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * A repeat on the same lobby answers like the first report and changes nothing. A lobby the
   * viewer can't see answers 404 exactly like a missing one.
   */
  async report(reporterId: string, lobbyId: string, input: ReportInput): Promise<ReportResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [lobby] = await tx
        .select({ hostId: lobbies.hostId })
        .from(lobbies)
        .where(eq(lobbies.id, lobbyId));
      // Both users locked in id order: the reporter's cap and the host's count can't race.
      await this.lockUsers(tx, lobby ? [reporterId, lobby.hostId] : [reporterId]);
      const reporter = await this.lobbies.viewer(tx, reporterId, now);
      if (!reporter.onboarded) throw apiError('not_onboarded');

      const [existing] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.reporterId, reporterId), eq(reports.lobbyId, lobbyId)));
      if (existing) return { reported: true };

      const { row, rights } = await this.lobbies.visibleLobby(tx, lobbyId, reporterId, now);
      if (rights.isHost) throw apiError('report_own_lobby');

      const [sent] = await tx
        .select({ n: count() })
        .from(reports)
        .where(
          and(
            eq(reports.reporterId, reporterId),
            gt(reports.createdAt, new Date(now.getTime() - REPORTS_WINDOW_HOURS * HOUR_MS)),
          ),
        );
      if ((sent?.n ?? 0) >= REPORTS_PER_DAY_MAX) throw apiError('reports_daily_limit');

      const subjectId = row.hostId;
      const kase = await this.openReportsCase(tx, subjectId, now);
      const [facts] = await tx
        .select({
          isShadowBanned: users.isShadowBanned,
          createdAt: users.createdAt,
          reportedInCase:
            sql<boolean>`exists (select 1 from ${reports} where ${reports.caseId} = ${kase.id} and ${reports.reporterId} = ${reporterId})`.mapWith(
              Boolean,
            ),
        })
        .from(users)
        .where(eq(users.id, reporterId));
      await tx.insert(reports).values({
        reporterId,
        lobbyId,
        subjectId,
        caseId: kase.id,
        reason: input.reason,
        comment: input.comment,
        notCounted: notCountedReason(facts!, now),
        createdAt: now,
      });
      await this.shadowBanAtThreshold(tx, subjectId, kase, now);
      return { reported: true };
    });
  }

  /** The subject's open reports case, opened by the first report. Under the subject's lock. */
  private async openReportsCase(tx: DbTransaction, subjectId: string, now: Date) {
    const where = and(
      eq(moderationCases.kind, 'reports'),
      eq(moderationCases.subjectId, subjectId),
      isNull(moderationCases.resolvedAt),
    );
    const [open] = await tx
      .select({ id: moderationCases.id, shadowBannedAt: moderationCases.shadowBannedAt })
      .from(moderationCases)
      .where(where);
    if (open) return open;
    const [created] = await tx
      .insert(moderationCases)
      .values({ kind: 'reports', subjectId, openedAt: now })
      .returning({ id: moderationCases.id, shadowBannedAt: moderationCases.shadowBannedAt });
    return created!;
  }

  /** SHADOW_BAN_REPORTS distinct counted reporters ban the subject, once per case. */
  private async shadowBanAtThreshold(
    tx: DbTransaction,
    subjectId: string,
    kase: { id: string; shadowBannedAt: Date | null },
    now: Date,
  ): Promise<void> {
    if (kase.shadowBannedAt !== null) return;
    const [counted] = await tx
      .select({ n: countDistinct(reports.reporterId) })
      .from(reports)
      .where(and(eq(reports.caseId, kase.id), isNull(reports.notCounted)));
    if ((counted?.n ?? 0) < SHADOW_BAN_REPORTS) return;
    const banned = await tx
      .update(users)
      .set({ isShadowBanned: true, updatedAt: now })
      .where(and(eq(users.id, subjectId), eq(users.isShadowBanned, false)))
      .returning({ id: users.id });
    if (banned.length === 0) return;
    await tx.update(moderationCases).set({ shadowBannedAt: now }).where(eq(moderationCases.id, kase.id));
    await logModeration(tx, [{ actorId: null, subjectId, action: 'auto_shadow_ban', caseId: kase.id }], now);
    await notifyModerators(tx, this.outbox, this.env.ADMIN_TELEGRAM_IDS, { id: kase.id, subjectId }, now);
  }

  private async lockUsers(tx: DbTransaction, ids: string[]): Promise<void> {
    for (const id of [...new Set(ids)].sort()) await lockUser(tx, id);
  }
}
