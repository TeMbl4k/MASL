import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  karmaEvents,
  lobbies,
  lobbyFeedback,
  lobbyMembers,
  moderationCases,
  reports,
  users,
  type Database,
} from '@masl/db';
import {
  CASE_DECISIONS,
  KARMA,
  MODERATION_PAGE_SIZE,
  REPORT_REASONS,
  effectiveLobbyStatus,
  type AdminCancelLobbyInput,
  type AdminCancelLobbyResponse,
  type AdminCaseDto,
  type AdminCasesQuery,
  type AdminCasesResponse,
  type AdminReportDto,
  type ResolveCaseInput,
} from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { KarmaService, type DbTransaction } from '../karma/karma.service.js';
import { LobbiesService } from '../lobbies/lobbies.service.js';
import { at, lockLobby, lockUser, type Executor } from '../lobbies/lobby-queries.js';
import {
  loadAdminLobby,
  loadAdminUser,
  loadAppealRefund,
  loadCreationBlock,
  loadUserStats,
  upcomingLobbyIds,
} from './admin-queries.js';
import { decodeCaseCursor, encodeCaseCursor } from './case-cursor.js';
import { logModeration, type LogEntry } from './moderation-log.js';
import { blockCreation, setShadowBan, unblockCreation } from './user-flags.js';

/** The comment members see in their karma history when a moderator takes back their no-show. */
export const NO_SHOW_LIFTED_COMMENT = 'Неявка снята модератором';

const reporter = alias(users, 'reporter');
const resolver = alias(users, 'resolver');

/** Shadow-banned report cases first: they hide a host until someone decides. */
const bannedLastSql = sql<boolean>`(${moderationCases.shadowBannedAt} is null)`;

/**
 * The moderation queue, cases and decisions, and the moderator's lobby cancel (spec stage 4
 * §2.1, §4.2). Every decision runs in one transaction under the subject's lock, then the lobby's
 * and the members' (lock order of decisions.md), and lands in the moderation log.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(KarmaService) private readonly karma: KarmaService,
  ) {}

  /** Open cases, MODERATION_PAGE_SIZE a page, with counts per kind whatever the filter. */
  async queue(query: AdminCasesQuery): Promise<AdminCasesResponse> {
    const cursor = query.cursor ? decodeCaseCursor(query.cursor) : null;
    const rows = await this.db
      .select({
        id: moderationCases.id,
        kind: moderationCases.kind,
        openedAt: moderationCases.openedAt,
        shadowBannedAt: moderationCases.shadowBannedAt,
        lobbyId: moderationCases.lobbyId,
        subjectId: users.id,
        firstName: users.firstName,
        karma: users.karma,
        blockKind: users.creationBlockedReason,
      })
      .from(moderationCases)
      .innerJoin(users, eq(users.id, moderationCases.subjectId))
      .where(
        and(
          isNull(moderationCases.resolvedAt),
          query.kind ? eq(moderationCases.kind, query.kind) : undefined,
          cursor
            ? sql`(${bannedLastSql}, ${moderationCases.openedAt}, ${moderationCases.id}) > (${!cursor.banned}::boolean, ${at(cursor.openedAt)}, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(bannedLastSql, asc(moderationCases.openedAt), asc(moderationCases.id))
      .limit(MODERATION_PAGE_SIZE + 1);
    const page = rows.slice(0, MODERATION_PAGE_SIZE);
    const last = rows.length > MODERATION_PAGE_SIZE ? page.at(-1) : undefined;

    const reportCaseIds = page.filter((row) => row.kind === 'reports').map((row) => row.id);
    const caseReports =
      reportCaseIds.length === 0
        ? []
        : await this.db
            .select({
              caseId: reports.caseId,
              reporterId: reports.reporterId,
              reason: reports.reason,
              notCounted: reports.notCounted,
              lobbyId: lobbies.id,
              lobbyTitle: lobbies.title,
            })
            .from(reports)
            .innerJoin(lobbies, eq(lobbies.id, reports.lobbyId))
            .where(inArray(reports.caseId, reportCaseIds))
            .orderBy(desc(reports.createdAt), desc(reports.id));
    const lobbyIds = page.flatMap((row) =>
      row.kind !== 'reports' && row.lobbyId !== null ? [row.lobbyId] : [],
    );
    const titles =
      lobbyIds.length === 0
        ? []
        : await this.db
            .select({ id: lobbies.id, title: lobbies.title })
            .from(lobbies)
            .where(inArray(lobbies.id, lobbyIds));
    const notHeld =
      lobbyIds.length === 0
        ? []
        : await this.db
            .select({ lobbyId: lobbyFeedback.lobbyId, n: count() })
            .from(lobbyFeedback)
            .where(and(inArray(lobbyFeedback.lobbyId, lobbyIds), eq(lobbyFeedback.rating, 'not_held')))
            .groupBy(lobbyFeedback.lobbyId);
    const counts = await this.db
      .select({ kind: moderationCases.kind, n: count() })
      .from(moderationCases)
      .where(isNull(moderationCases.resolvedAt))
      .groupBy(moderationCases.kind);
    const countOf = (kind: string) => counts.find((c) => c.kind === kind)?.n ?? 0;

    return {
      items: page.map((row) => {
        const own = caseReports.filter((r) => r.caseId === row.id);
        const latest = own[0];
        const lobbyTitle = titles.find((t) => t.id === row.lobbyId)?.title;
        return {
          id: row.id,
          kind: row.kind,
          openedAt: row.openedAt.toISOString(),
          subject: { id: row.subjectId, firstName: row.firstName, karma: row.karma },
          shadowBannedAt: row.shadowBannedAt?.toISOString() ?? null,
          lobby:
            row.kind === 'reports'
              ? latest
                ? { id: latest.lobbyId, title: latest.lobbyTitle }
                : null
              : row.lobbyId !== null && lobbyTitle !== undefined
                ? { id: row.lobbyId, title: lobbyTitle }
                : null,
          reports:
            row.kind === 'reports'
              ? {
                  total: own.length,
                  counted: new Set(own.filter((r) => r.notCounted === null).map((r) => r.reporterId)).size,
                  reasons: REPORT_REASONS.filter((reason) => own.some((r) => r.reason === reason)),
                }
              : null,
          notHeld: row.kind === 'not_held' ? (notHeld.find((n) => n.lobbyId === row.lobbyId)?.n ?? 0) : null,
          blockKind: row.kind === 'appeal' ? row.blockKind : null,
        };
      }),
      nextCursor: last
        ? encodeCaseCursor({ banned: last.shadowBannedAt !== null, openedAt: last.openedAt, id: last.id })
        : null,
      counts: {
        all: counts.reduce((sum, c) => sum + c.n, 0),
        reports: countOf('reports'),
        not_held: countOf('not_held'),
        appeal: countOf('appeal'),
      },
    };
  }

  async detail(viewerId: string, caseId: string): Promise<AdminCaseDto> {
    return this.caseDto(this.db, caseId, viewerId, this.clock.now());
  }

  /**
   * Closes the case with a decision that fits its kind; 409 `case_resolved` once decided, so a
   * double tap can't apply karma twice (the karma unique index backs this up).
   */
  async resolve(viewerId: string, caseId: string, input: ResolveCaseInput): Promise<AdminCaseDto> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ subjectId: moderationCases.subjectId, kind: moderationCases.kind })
        .from(moderationCases)
        .where(eq(moderationCases.id, caseId));
      if (!found) throw apiError('case_not_found');
      if (!CASE_DECISIONS[found.kind].includes(input.decision)) throw apiError('decision_mismatch');
      if (found.subjectId === viewerId) throw apiError('self_moderation');

      await lockUser(tx, found.subjectId);
      const [kase] = await tx
        .select()
        .from(moderationCases)
        .where(eq(moderationCases.id, caseId))
        .for('update');
      if (!kase) throw apiError('case_not_found');
      if (kase.resolvedAt !== null) throw apiError('case_resolved');

      const subjectId = kase.subjectId;
      const by = { actorId: viewerId, subjectId, caseId };
      const log: LogEntry[] = [];
      switch (input.decision) {
        case 'reports_dismissed':
          // Only a ban this case set is lifted; one a moderator kept stays.
          if (kase.shadowBannedAt !== null && (await setShadowBan(tx, subjectId, false, now))) {
            log.push({ ...by, action: 'lift_shadow_ban' });
          }
          break;
        case 'reports_confirmed':
          if (await setShadowBan(tx, subjectId, true, now)) log.push({ ...by, action: 'shadow_ban' });
          if (input.cancelUpcoming) {
            for (const lobbyId of await upcomingLobbyIds(tx, subjectId, now)) {
              await lockLobby(tx, lobbyId);
              if (await this.lobbies.cancelForModeration(tx, lobbyId, now)) {
                log.push({ ...by, action: 'cancel_lobby', lobbyId });
              }
            }
          }
          if (input.blockCreation) {
            await blockCreation(tx, subjectId, null, now);
            log.push({ ...by, action: 'block_creation' });
          }
          break;
        case 'meetup_held':
          break;
        case 'host_flaked':
          log.push(...(await this.hostFlaked(tx, viewerId, kase, now)));
          break;
        case 'appeal_approved':
          log.push(...(await this.approveAppeal(tx, viewerId, kase, input.refundKarma, now)));
          break;
        case 'appeal_rejected':
          break;
      }
      await tx
        .update(moderationCases)
        .set({
          resolvedAt: now,
          resolvedBy: viewerId,
          decision: input.decision,
          decisionComment: input.comment,
        })
        .where(eq(moderationCases.id, caseId));
      await logModeration(
        tx,
        [{ ...by, action: 'resolve_case', lobbyId: kase.lobbyId, comment: input.comment }, ...log],
        now,
      );
      return this.caseDto(tx, caseId, viewerId, now);
    });
  }

  /**
   * «Организатор сорвал встречу»: the host gets KARMA.HOST_LATE_CANCEL less the `hosted` award
   * they got for the lobby, and a creation block; members marked no_show get their penalty back.
   */
  private async hostFlaked(
    tx: DbTransaction,
    actorId: string,
    kase: { id: string; subjectId: string; lobbyId: string | null },
    now: Date,
  ): Promise<LogEntry[]> {
    const lobbyId = kase.lobbyId;
    if (lobbyId === null || !(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
    const by = { actorId, caseId: kase.id, lobbyId };
    const log: LogEntry[] = [];
    const hosted = await tx
      .select({ delta: karmaEvents.delta })
      .from(karmaEvents)
      .where(
        and(
          eq(karmaEvents.userId, kase.subjectId),
          eq(karmaEvents.lobbyId, lobbyId),
          eq(karmaEvents.reason, 'hosted'),
        ),
      );
    const award = hosted.reduce((sum, row) => sum + row.delta, 0);
    const penalty = await this.karma.apply(tx, {
      userId: kase.subjectId,
      lobbyId,
      reason: 'moderation',
      delta: KARMA.HOST_LATE_CANCEL - award,
      now,
    });
    if (penalty !== null)
      log.push({ ...by, subjectId: kase.subjectId, action: 'karma_change', karmaDelta: penalty });
    await blockCreation(tx, kase.subjectId, lobbyId, now);
    log.push({ ...by, subjectId: kase.subjectId, action: 'block_creation' });

    const noShows = await tx
      .select({ userId: lobbyMembers.userId })
      .from(lobbyMembers)
      .where(and(eq(lobbyMembers.lobbyId, lobbyId), eq(lobbyMembers.status, 'no_show')))
      .orderBy(asc(lobbyMembers.userId));
    for (const member of noShows) {
      const refund = await this.karma.apply(tx, {
        userId: member.userId,
        lobbyId,
        reason: 'moderation',
        delta: Math.abs(KARMA.NO_SHOW),
        comment: NO_SHOW_LIFTED_COMMENT,
        now,
      });
      if (refund !== null)
        log.push({ ...by, subjectId: member.userId, action: 'karma_change', karmaDelta: refund });
    }
    return log;
  }

  /** «Снять блокировку», optionally with the karma the block's cause cost, once per lobby. */
  private async approveAppeal(
    tx: DbTransaction,
    actorId: string,
    kase: { id: string; subjectId: string; lobbyId: string | null },
    refundKarma: boolean,
    now: Date,
  ): Promise<LogEntry[]> {
    const by = { actorId, subjectId: kase.subjectId, caseId: kase.id };
    const log: LogEntry[] = [];
    const [subject] = await tx
      .select({ id: users.id, karma: users.karma })
      .from(users)
      .where(eq(users.id, kase.subjectId));
    const refund = refundKarma && subject ? await loadAppealRefund(tx, subject, kase.lobbyId) : 0;
    if (await unblockCreation(tx, kase.subjectId, now)) log.push({ ...by, action: 'unblock_creation' });
    if (refund > 0 && kase.lobbyId !== null) {
      const applied = await this.karma.apply(tx, {
        userId: kase.subjectId,
        lobbyId: kase.lobbyId,
        reason: 'appeal_refund',
        delta: refund,
        now,
      });
      if (applied !== null) {
        log.push({ ...by, action: 'karma_change', lobbyId: kase.lobbyId, karmaDelta: applied });
      }
    }
    return log;
  }

  /** A moderator cancels an open lobby that has not started: no penalty for the host. */
  async cancelLobby(
    viewerId: string,
    lobbyId: string,
    input: AdminCancelLobbyInput,
  ): Promise<AdminCancelLobbyResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ hostId: lobbies.hostId })
        .from(lobbies)
        .where(eq(lobbies.id, lobbyId));
      if (!found) throw apiError('lobby_not_found');
      if (found.hostId === viewerId) throw apiError('self_moderation');
      await lockUser(tx, found.hostId);
      await lockLobby(tx, lobbyId);
      const [row] = await tx
        .select({ status: lobbies.status, startsAt: lobbies.startsAt, endsAt: lobbies.endsAt })
        .from(lobbies)
        .where(eq(lobbies.id, lobbyId));
      const status = effectiveLobbyStatus(row!, now);
      if (status === 'cancelled') throw apiError('lobby_cancelled');
      if (status !== 'open') throw apiError('lobby_started');
      await this.lobbies.cancelForModeration(tx, lobbyId, now);
      await logModeration(
        tx,
        [
          {
            actorId: viewerId,
            subjectId: found.hostId,
            action: 'cancel_lobby',
            lobbyId,
            comment: input.comment,
          },
        ],
        now,
      );
      return { lobby: (await loadAdminLobby(tx, lobbyId, now))! };
    });
  }

  private async caseDto(db: Executor, caseId: string, viewerId: string, now: Date): Promise<AdminCaseDto> {
    const [kase] = await db
      .select({
        id: moderationCases.id,
        kind: moderationCases.kind,
        subjectId: moderationCases.subjectId,
        lobbyId: moderationCases.lobbyId,
        appealText: moderationCases.appealText,
        shadowBannedAt: moderationCases.shadowBannedAt,
        openedAt: moderationCases.openedAt,
        resolvedAt: moderationCases.resolvedAt,
        decision: moderationCases.decision,
        decisionComment: moderationCases.decisionComment,
        resolverId: resolver.id,
        resolverFirstName: resolver.firstName,
      })
      .from(moderationCases)
      .leftJoin(resolver, eq(resolver.id, moderationCases.resolvedBy))
      .where(eq(moderationCases.id, caseId));
    if (!kase) throw apiError('case_not_found');
    const subject = await loadAdminUser(db, kase.subjectId, this.env.ADMIN_TELEGRAM_IDS);
    if (!subject) throw apiError('case_not_found');
    const caseReports = kase.kind === 'reports' ? await this.caseReports(db, kase.id) : [];
    const lobbyId = kase.kind === 'reports' ? (caseReports[0]?.lobby.id ?? null) : kase.lobbyId;
    const open = kase.resolvedAt === null;
    return {
      id: kase.id,
      kind: kase.kind,
      status: open ? 'open' : 'resolved',
      openedAt: kase.openedAt.toISOString(),
      resolvedAt: kase.resolvedAt?.toISOString() ?? null,
      decision: kase.decision,
      decisionComment: kase.decisionComment,
      resolvedBy:
        kase.resolverId !== null && kase.resolverFirstName !== null
          ? { id: kase.resolverId, firstName: kase.resolverFirstName }
          : null,
      subject,
      stats: await loadUserStats(db, kase.subjectId),
      shadowBannedAt: kase.shadowBannedAt?.toISOString() ?? null,
      reports: caseReports,
      lobby: lobbyId === null ? null : await loadAdminLobby(db, lobbyId, now),
      appealText: kase.appealText,
      block: await loadCreationBlock(db, kase.subjectId),
      upcomingLobbies: (await upcomingLobbyIds(db, kase.subjectId, now)).length,
      refund: kase.kind === 'appeal' && open ? await loadAppealRefund(db, subject, kase.lobbyId) : 0,
      isSelf: kase.subjectId === viewerId,
    };
  }

  /** The case's reports, newest first, with the reporters as moderators see them. */
  private async caseReports(db: Executor, caseId: string): Promise<AdminReportDto[]> {
    const rows = await db
      .select({
        id: reports.id,
        createdAt: reports.createdAt,
        reason: reports.reason,
        comment: reports.comment,
        notCounted: reports.notCounted,
        reporterId: reporter.id,
        reporterFirstName: reporter.firstName,
        reporterKarma: reporter.karma,
        reporterJoinedAt: reporter.createdAt,
        lobbyId: lobbies.id,
        lobbyTitle: lobbies.title,
      })
      .from(reports)
      .innerJoin(reporter, eq(reporter.id, reports.reporterId))
      .innerJoin(lobbies, eq(lobbies.id, reports.lobbyId))
      .where(eq(reports.caseId, caseId))
      .orderBy(desc(reports.createdAt), desc(reports.id));
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      reason: row.reason,
      comment: row.comment,
      notCounted: row.notCounted,
      reporter: {
        id: row.reporterId,
        firstName: row.reporterFirstName,
        karma: row.reporterKarma,
        joinedAt: row.reporterJoinedAt.toISOString(),
      },
      lobby: { id: row.lobbyId, title: row.lobbyTitle },
    }));
  }
}
