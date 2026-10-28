import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { lobbies, moderationActions, moderationCases, users, type Database } from '@masl/db';
import {
  ADMIN_ONLY_ACTIONS,
  MODERATION_HISTORY_LIMIT,
  MODERATION_PAGE_SIZE,
  type AdminUserCardDto,
  type AdminUserSearchQuery,
  type AdminUserSearchResponse,
  type ModerationLogEntryDto,
  type UserActionInput,
} from '@masl/shared';
import { OutboxService } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { KarmaService, type DbTransaction } from '../karma/karma.service.js';
import { lockUser, prefixPattern, type Executor } from '../lobbies/lobby-queries.js';
import {
  loadAdminUser,
  loadCreationBlock,
  loadUserStats,
  selectAdminUsers,
  toAdminUser,
} from './admin-queries.js';
import { logModeration, type LogEntry } from './moderation-log.js';
import { blockCreation, setShadowBan, unblockCreation } from './user-flags.js';

const actor = alias(users, 'actor');

/** Search, the user card and what a moderator can do from it (spec stage 4 §4.2). */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(KarmaService) private readonly karma: KarmaService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** By an exact Telegram id, or by the start of @username, first or last name. */
  async search(query: AdminUserSearchQuery): Promise<AdminUserSearchResponse> {
    const q = query.q.trim();
    const pattern = prefixPattern(q.replace(/^@/, ''));
    const byName = or(
      ilike(users.username, pattern),
      ilike(users.firstName, pattern),
      ilike(users.lastName, pattern),
    );
    const telegramId = /^\d{1,15}$/.test(q) ? Number(q) : null;
    const rows = await selectAdminUsers(this.db)
      .where(telegramId === null ? byName : or(eq(users.telegramId, telegramId), byName))
      .orderBy(asc(users.firstName), asc(users.id))
      .limit(MODERATION_PAGE_SIZE);
    return { items: rows.map((row) => toAdminUser(row, this.env.ADMIN_TELEGRAM_IDS)) };
  }

  async card(viewerId: string, userId: string, viewerIsAdmin: boolean): Promise<AdminUserCardDto> {
    return this.cardFor(this.db, viewerId, userId, viewerIsAdmin);
  }

  /**
   * One action on a user under their lock: flags, karma, the moderator role (admins only).
   * Nobody acts on themselves. Lifting the creation block approves an open appeal.
   */
  async act(
    viewerId: string,
    userId: string,
    viewerIsAdmin: boolean,
    input: UserActionInput,
  ): Promise<AdminUserCardDto> {
    if (ADMIN_ONLY_ACTIONS.includes(input.action) && !viewerIsAdmin) throw apiError('admin_only');
    if (userId === viewerId) throw apiError('self_moderation');
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      if (!(await lockUser(tx, userId))) throw apiError('user_not_found');
      const entry: LogEntry = {
        actorId: viewerId,
        subjectId: userId,
        action: input.action,
        comment: input.comment,
      };
      const logged = await this.apply(tx, viewerId, userId, input, now);
      if (logged !== false) {
        await logModeration(tx, [{ ...entry, karmaDelta: typeof logged === 'number' ? logged : null }], now);
      }
      return this.cardFor(tx, viewerId, userId, viewerIsAdmin);
    });
  }

  /** Applies the action; false when it changed nothing, the karma applied for karma_change. */
  private async apply(
    tx: DbTransaction,
    viewerId: string,
    userId: string,
    input: UserActionInput,
    now: Date,
  ): Promise<boolean | number> {
    switch (input.action) {
      case 'shadow_ban':
        return setShadowBan(tx, userId, true, now);
      case 'lift_shadow_ban':
        return setShadowBan(tx, userId, false, now);
      case 'block_creation':
        await blockCreation(tx, userId, null, now);
        return true;
      case 'unblock_creation': {
        if (!(await unblockCreation(tx, userId, now))) return false;
        const approved = await tx
          .update(moderationCases)
          .set({
            resolvedAt: now,
            resolvedBy: viewerId,
            decision: 'appeal_approved',
            decisionComment: input.comment,
          })
          .where(
            and(
              eq(moderationCases.kind, 'appeal'),
              eq(moderationCases.subjectId, userId),
              isNull(moderationCases.resolvedAt),
            ),
          )
          .returning({ id: moderationCases.id });
        await this.outbox.enqueue(
          tx,
          approved.map((c) => ({ kind: 'user_appeal_approved' as const, userId, caseId: c.id })),
          now,
        );
        return true;
      }
      case 'karma_change': {
        const applied = await this.karma.apply(tx, {
          userId,
          lobbyId: null,
          reason: 'manual',
          delta: input.karmaDelta!,
          comment: input.comment,
          now,
        });
        return applied ?? false;
      }
      case 'grant_moderator':
      case 'revoke_moderator': {
        const grant = input.action === 'grant_moderator';
        const changed = await tx
          .update(users)
          .set({ isModerator: grant, updatedAt: now })
          .where(and(eq(users.id, userId), eq(users.isModerator, !grant)))
          .returning({ id: users.id });
        return changed.length > 0;
      }
    }
  }

  private async cardFor(
    db: Executor,
    viewerId: string,
    userId: string,
    viewerIsAdmin: boolean,
  ): Promise<AdminUserCardDto> {
    const user = await loadAdminUser(db, userId, this.env.ADMIN_TELEGRAM_IDS);
    if (!user) throw apiError('user_not_found');
    const openCases = await db
      .select({ id: moderationCases.id, kind: moderationCases.kind, openedAt: moderationCases.openedAt })
      .from(moderationCases)
      .where(and(eq(moderationCases.subjectId, userId), isNull(moderationCases.resolvedAt)))
      .orderBy(asc(moderationCases.openedAt), asc(moderationCases.id));
    return {
      user,
      stats: await loadUserStats(db, userId),
      block: await loadCreationBlock(db, userId),
      openCases: openCases.map((c) => ({ id: c.id, kind: c.kind, openedAt: c.openedAt.toISOString() })),
      history: await this.history(db, userId),
      isSelf: userId === viewerId,
      viewerIsAdmin,
    };
  }

  /** The latest MODERATION_HISTORY_LIMIT log entries about the user, newest first. */
  private async history(db: Executor, userId: string): Promise<ModerationLogEntryDto[]> {
    const rows = await db
      .select({
        id: moderationActions.id,
        createdAt: moderationActions.createdAt,
        action: moderationActions.action,
        actorId: actor.id,
        actorFirstName: actor.firstName,
        karmaDelta: moderationActions.karmaDelta,
        comment: moderationActions.comment,
        decision: moderationCases.decision,
        caseId: moderationActions.caseId,
        lobbyId: lobbies.id,
        lobbyTitle: lobbies.title,
      })
      .from(moderationActions)
      .leftJoin(actor, eq(actor.id, moderationActions.actorId))
      .leftJoin(lobbies, eq(lobbies.id, moderationActions.lobbyId))
      .leftJoin(moderationCases, eq(moderationCases.id, moderationActions.caseId))
      .where(eq(moderationActions.subjectId, userId))
      .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
      .limit(MODERATION_HISTORY_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      actor:
        row.actorId !== null && row.actorFirstName !== null
          ? { id: row.actorId, firstName: row.actorFirstName }
          : null,
      karmaDelta: row.karmaDelta,
      comment: row.comment,
      decision: row.action === 'resolve_case' ? row.decision : null,
      caseId: row.caseId,
      lobby:
        row.lobbyId !== null && row.lobbyTitle !== null ? { id: row.lobbyId, title: row.lobbyTitle } : null,
    }));
  }
}
