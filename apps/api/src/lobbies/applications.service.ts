import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { applicationEvents, lobbyMembers, type Database } from '@masl/db';
import {
  APPLICATIONS_PENDING_MAX,
  APPLICATIONS_PER_DAY_MAX,
  HOST_APPLICATIONS_NOTIFY_DELAY_SECONDS,
  KARMA,
  OCCUPYING_MEMBERSHIP_STATUSES,
  isLateCancel,
  meetsMinKarma,
  type CancelApplicationResponse,
  type HostApplicationsResponse,
  type LobbyDetailDto,
  type MembershipStatus,
} from '@masl/shared';
import { OutboxService } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { KarmaService, type DbTransaction } from '../karma/karma.service.js';
import { LobbiesService } from './lobbies.service.js';
import { toApplicant, toLobbyCard } from './lobby.mapper.js';
import {
  applicantsQuery,
  loadActiveChat,
  lockApplication,
  lockLobby,
  lockOwnMembership,
  type Executor,
} from './lobby-queries.js';

export type HostDecision = 'approve' | 'reject';

const OCCUPYING: readonly MembershipStatus[] = OCCUPYING_MEMBERSHIP_STATUSES;

/**
 * Applications: apply, cancel own, and the host's list and decisions (spec §5.6). Every
 * mutation takes its locks in the global order user → lobby → membership → karma (§8).
 */
@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(KarmaService) private readonly karma: KarmaService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /**
   * Applies for a place. A new or renewed application is `created`; while pending or approved
   * a repeat returns the current detail.
   */
  async apply(userId: string, lobbyId: string): Promise<{ created: boolean; lobby: LobbyDetailDto }> {
    const now = this.clock.now();
    return this.db.transaction((tx) => this.applyIn(tx, userId, lobbyId, now, null));
  }

  /**
   * The apply step inside the caller's transaction; `inviteId` marks an application made with a
   * member's invite (stage 6), which passes every check of a plain one. Locks already held by
   * the caller are taken again harmlessly.
   */
  async applyIn(
    tx: DbTransaction,
    userId: string,
    lobbyId: string,
    now: Date,
    inviteId: string | null,
  ): Promise<{ created: boolean; lobby: LobbyDetailDto }> {
    // The user lock serializes this user's applies, so the caps hold under parallel requests.
    await this.lobbies.lockActor(tx, userId);
    const viewer = await this.lobbies.viewer(tx, userId, now);
    if (!viewer.onboarded) throw apiError('not_onboarded');

    if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
    const { row, rights, effectiveStatus } = await this.lobbies.visibleLobby(tx, lobbyId, userId, now);
    if (rights.isHost) throw apiError('own_lobby');
    if (effectiveStatus === 'cancelled') throw apiError('lobby_cancelled');
    if (effectiveStatus !== 'open') throw apiError('lobby_closed');

    const membership = await lockOwnMembership(tx, lobbyId, userId);
    if (membership?.status === 'rejected') throw apiError('application_rejected');
    if (membership?.status === 'cancelled' && membership.decidedAt !== null) {
      throw apiError('application_left');
    }
    if (membership && membership.status !== 'cancelled') {
      return {
        created: false,
        lobby: await this.lobbies.detailFor(tx, { lobbyId, viewerId: userId, now }),
      };
    }

    if (row.minKarma !== null && !meetsMinKarma(viewer.karma, row.minKarma)) {
      throw apiError('karma_too_low', { minKarma: row.minKarma, karma: viewer.karma });
    }
    if (row.approvedCount >= row.slots) throw apiError('lobby_full');
    if (!viewer.team && viewer.pendingApplications >= APPLICATIONS_PENDING_MAX) {
      throw apiError('pending_limit');
    }
    if (!viewer.team && viewer.applicationsInWindow >= APPLICATIONS_PER_DAY_MAX) {
      throw apiError('applications_daily_limit');
    }

    if (membership) {
      // A withdrawn application comes back as a new one; decided_at stays null.
      await tx
        .update(lobbyMembers)
        .set({ status: 'pending', appliedAt: now, cancelledAt: null, inviteId, updatedAt: now })
        .where(eq(lobbyMembers.id, membership.id));
    } else {
      await tx.insert(lobbyMembers).values({
        lobbyId,
        userId,
        status: 'pending',
        appliedAt: now,
        inviteId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await tx.insert(applicationEvents).values({ userId, lobbyId, createdAt: now });
    // Applications arriving close together reach the host as one message.
    await this.outbox.enqueue(
      tx,
      [
        {
          kind: 'host_new_applications',
          userId: row.hostId,
          lobbyId,
          dedupeKey: `host_apps:${lobbyId}`,
          sendAfter: new Date(now.getTime() + HOST_APPLICATIONS_NOTIFY_DELAY_SECONDS * 1000),
        },
      ],
      now,
    );
    return { created: true, lobby: await this.lobbies.detailFor(tx, { lobbyId, viewerId: userId, now }) };
  }

  /**
   * Withdraws the caller's application or leaves an approved place, before the start only.
   * Leaving less than LATE_CANCEL_WINDOW_HOURS before the start costs KARMA.LATE_CANCEL once.
   */
  async cancelOwn(userId: string, lobbyId: string): Promise<CancelApplicationResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      await this.lobbies.lockActor(tx, userId);
      if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
      const { row, effectiveStatus } = await this.lobbies.visibleLobby(tx, lobbyId, userId, now);

      const membership = await lockOwnMembership(tx, lobbyId, userId);
      if (!membership || membership.status === 'rejected') throw apiError('application_not_found');
      const detail = () => this.lobbies.detailFor(tx, { lobbyId, viewerId: userId, now, keepVisible: true });
      if (membership.status === 'cancelled') return { lobby: await detail(), karmaDelta: 0 };
      if (effectiveStatus === 'cancelled') throw apiError('lobby_cancelled');
      if (effectiveStatus !== 'open') throw apiError('lobby_started');

      await tx
        .update(lobbyMembers)
        .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
        .where(and(eq(lobbyMembers.id, membership.id), eq(lobbyMembers.status, membership.status)));

      let karmaDelta = 0;
      if (membership.status === 'approved') {
        const chatId = membership.chatJoinedAt ? await loadActiveChat(tx, lobbyId) : null;
        await this.outbox.enqueue(
          tx,
          [
            { kind: 'host_member_left', userId: row.hostId, lobbyId, memberId: membership.id },
            ...(chatId === null
              ? []
              : [{ kind: 'group_kick' as const, chatId, lobbyId, memberId: membership.id }]),
          ],
          now,
        );
      }
      if (membership.status === 'approved' && isLateCancel(row.startsAt, now)) {
        const applied = await this.karma.apply(tx, {
          userId,
          lobbyId,
          reason: 'late_cancel',
          delta: KARMA.LATE_CANCEL,
          now,
        });
        if (applied !== null) karmaDelta = applied;
      }
      return { lobby: await detail(), karmaDelta };
    });
  }

  /** The host's applications list; 403 for anyone else. */
  async list(userId: string, lobbyId: string): Promise<HostApplicationsResponse> {
    const now = this.clock.now();
    const { rights } = await this.lobbies.visibleLobby(this.db, lobbyId, userId, now);
    if (!rights.isHost) throw apiError('not_host');
    return this.hostApplications(this.db, lobbyId, userId, now);
  }

  /**
   * Approves or rejects a pending application. Approval re-checks the lobby's karma threshold
   * and the free places under the lobby lock, so parallel approvals never overfill it.
   */
  async decide(
    userId: string,
    lobbyId: string,
    applicationId: string,
    decision: HostDecision,
  ): Promise<HostApplicationsResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
      const { row, rights, effectiveStatus } = await this.lobbies.visibleLobby(tx, lobbyId, userId, now);
      if (!rights.isHost) throw apiError('not_host');

      const application = await lockApplication(tx, lobbyId, applicationId);
      // Exactly the rows the host's list hides don't exist for the host (Q22).
      if (!application?.visibleToHost) throw apiError('application_not_found');
      if (effectiveStatus === 'cancelled') throw apiError('lobby_cancelled');
      if (effectiveStatus !== 'open') throw apiError('lobby_closed');

      const target: MembershipStatus = decision === 'approve' ? 'approved' : 'rejected';
      if (application.status !== target) {
        if (application.status !== 'pending') throw apiError('application_not_pending');
        if (decision === 'approve') {
          if (!meetsMinKarma(application.applicantKarma, row.minKarma)) {
            throw apiError('applicant_karma_too_low');
          }
          // Read after the lobby lock: every write that takes a place holds the same lock.
          if (row.approvedCount >= row.slots) throw apiError('lobby_full');
        }
        await tx
          .update(lobbyMembers)
          .set({ status: target, decidedAt: now, updatedAt: now })
          .where(and(eq(lobbyMembers.id, application.id), eq(lobbyMembers.status, 'pending')));
        await this.outbox.enqueue(
          tx,
          [
            {
              kind: decision === 'approve' ? 'member_approved' : 'member_rejected',
              userId: application.userId,
              lobbyId,
              memberId: application.id,
            },
          ],
          now,
        );
      }
      return this.hostApplications(tx, lobbyId, userId, now);
    });
  }

  /** Pending (oldest first), approved and rejected applications with the host's card. */
  private async hostApplications(
    db: Executor,
    lobbyId: string,
    hostId: string,
    now: Date,
  ): Promise<HostApplicationsResponse> {
    const { row } = await this.lobbies.visibleLobby(db, lobbyId, hostId, now);
    const viewer = await this.lobbies.viewer(db, hostId, now);
    const applicants = (await applicantsQuery(db, lobbyId)).map((a) => toApplicant(a, row.minKarma));
    return {
      lobby: toLobbyCard(row, viewer, now),
      pending: applicants.filter((a) => a.status === 'pending'),
      approved: applicants.filter((a) => OCCUPYING.includes(a.status)),
      rejected: applicants.filter((a) => a.status === 'rejected'),
    };
  }
}
