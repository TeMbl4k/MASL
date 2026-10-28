import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, not } from 'drizzle-orm';
import { lobbies, lobbyInvites, lobbyMembers, notifications, users, type Database } from '@masl/db';
import {
  HOUR_MS,
  INVITE_MESSAGES_PER_DAY_MAX,
  INVITES_PER_DAY_MAX,
  INVITES_WINDOW_HOURS,
  LOBBY_PENDING_INVITES_MAX,
  MY_INVITES_MAX,
  PERSON_SEARCHES_PER_HOUR,
  effectiveLobbyStatus,
  type InviteAnswerResponse,
  type InviteCandidateState,
  type InviteCandidatesQuery,
  type InviteCandidatesResponse,
  type MembershipStatus,
  type MyInviteDto,
  type MyInvitesResponse,
  type SendInvitesInput,
  type SendInvitesResponse,
} from '@masl/shared';
import { OutboxService, type OutboxMessage } from '../bot/outbox.service.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { ApplicationsService } from '../lobbies/applications.service.js';
import { LobbiesService } from '../lobbies/lobbies.service.js';
import { resolveLobbyAccess } from '../lobbies/lobby-access.js';
import { membershipOf, toLobbyCard } from '../lobbies/lobby.mapper.js';
import { lockLobby, lockOwnMembership, selectLobbyCards, type Executor } from '../lobbies/lobby-queries.js';
import { FixedWindowStore } from '../rate-limit/fixed-window.store.js';
import {
  companionCandidates,
  companionIds,
  inviteWorks,
  inviterUser,
  lobbyRelations,
  searchPeople,
} from './invite-queries.js';

const GOING: readonly MembershipStatus[] = ['approved', 'attended', 'no_show'];

/** A membership after which nobody may invite the person to the lobby again. */
const closesInvites = (m: { status: MembershipStatus; decidedAt: Date | null }) =>
  m.status !== 'cancelled' || m.decidedAt !== null;

/**
 * «Пригласить» (stage 6). The host and approved members invite while places remain; a host's
 * invite makes the invitee a member on «Иду», a member's becomes an application the host
 * decides. Locks follow the global order user → lobby → invite → membership.
 */
@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(FixedWindowStore) private readonly limits: FixedWindowStore,
  ) {}

  /** The lobby, if the viewer may invite to it: its host or an approved member, while open. */
  private async inviterLobby(db: Executor, lobbyId: string, viewerId: string, now: Date) {
    const { row, rights, effectiveStatus } = await this.lobbies.visibleLobby(db, lobbyId, viewerId, now);
    if (!rights.isHost && row.memberStatus !== 'approved') throw apiError('invite_not_allowed');
    if (effectiveStatus === 'cancelled') throw apiError('lobby_cancelled');
    if (effectiveStatus !== 'open') throw apiError('lobby_closed');
    return { row, isHost: rights.isHost };
  }

  private async sentToday(db: Executor, inviterId: string, now: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(lobbyInvites)
      .where(
        and(
          eq(lobbyInvites.inviterId, inviterId),
          gt(lobbyInvites.createdAt, new Date(now.getTime() - INVITES_WINDOW_HOURS * HOUR_MS)),
        ),
      );
    return row?.n ?? 0;
  }

  /**
   * The invite screen's list: a search over everyone (`all`, from PERSON_SEARCH_MIN characters)
   * or the viewer's companions. Searches are limited per hour, except for the team.
   */
  async candidates(
    viewerId: string,
    lobbyId: string,
    query: InviteCandidatesQuery,
  ): Promise<InviteCandidatesResponse> {
    const now = this.clock.now();
    const viewer = await this.lobbies.viewer(this.db, viewerId, now);
    if (!viewer.onboarded) throw apiError('not_onboarded');
    const { row } = await this.inviterLobby(this.db, lobbyId, viewerId, now);
    if (query.filter === 'all' && !viewer.team) {
      const taken = this.limits.take(
        [{ key: `personSearch:${viewerId}`, limit: PERSON_SEARCHES_PER_HOUR, windowMs: HOUR_MS }],
        now.getTime(),
      );
      if (!taken.allowed) throw apiError('searches_limit');
    }
    const people =
      query.filter === 'all'
        ? await searchPeople(this.db, viewerId, query.q!)
        : await companionCandidates(this.db, viewerId, query.q);
    const ids = people.map((p) => p.id);
    const [companions, relations, sent] = await Promise.all([
      query.filter === 'all' ? companionIds(this.db, viewerId, ids) : Promise.resolve(new Set(ids)),
      lobbyRelations(this.db, lobbyId, ids),
      viewer.team ? Promise.resolve(0) : this.sentToday(this.db, viewerId, now),
    ]);
    const stateOf = (id: string): InviteCandidateState => {
      const membership = relations.memberships.get(id);
      if (id === row.hostId || (membership && GOING.includes(membership.status))) return 'going';
      if (relations.invited.has(id)) return 'invited';
      // Pending, rejected and left look alike: a member never learns of another's application.
      return membership && closesInvites(membership) ? 'unavailable' : 'available';
    };
    return {
      items: people.map((p) => ({
        person: { code: p.code, firstName: p.firstName, photoUrl: p.photoUrl },
        companion: companions.has(p.id),
        state: stateOf(p.id),
      })),
      freeSlots: Math.max(0, row.slots - row.approvedCount),
      invitesLeft: viewer.team ? null : Math.max(0, INVITES_PER_DAY_MAX - sent),
    };
  }

  /**
   * Sends invites to the people of `codes` who can still be invited; the rest are `skipped`.
   * The bot tells an invitee at most INVITE_MESSAGES_PER_DAY_MAX times a day.
   */
  async send(viewerId: string, lobbyId: string, input: SendInvitesInput): Promise<SendInvitesResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      // The inviter lock keeps the daily cap; the lobby lock keeps the lobby's cap.
      await this.lobbies.lockActor(tx, viewerId);
      const viewer = await this.lobbies.viewer(tx, viewerId, now);
      if (!viewer.onboarded) throw apiError('not_onboarded');
      if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
      const { row, isHost } = await this.inviterLobby(tx, lobbyId, viewerId, now);
      if (row.approvedCount >= row.slots) throw apiError('lobby_full');

      const people = await tx
        .select({
          id: users.id,
          onboardedAt: users.onboardedAt,
          isShadowBanned: users.isShadowBanned,
          hideFromSearch: users.hideFromSearch,
          invitesEnabled: users.invitesEnabled,
          allowsWriteToPm: users.allowsWriteToPm,
        })
        .from(users)
        .where(inArray(users.publicCode, input.codes));
      const ids = people.map((p) => p.id);
      const [relations, companions] = await Promise.all([
        lobbyRelations(tx, lobbyId, ids),
        companionIds(tx, viewerId, ids),
      ]);
      const eligible = people.filter((p) => {
        const membership = relations.memberships.get(p.id);
        return (
          p.id !== viewerId &&
          p.id !== row.hostId &&
          p.onboardedAt !== null &&
          !p.isShadowBanned &&
          p.invitesEnabled &&
          // Hidden from search: only a companion can still find and invite them.
          (!p.hideFromSearch || companions.has(p.id)) &&
          !relations.invited.has(p.id) &&
          !(membership && closesInvites(membership))
        );
      });
      if (eligible.length === 0) return { sent: 0, skipped: input.codes.length };

      if (!viewer.team && (await this.sentToday(tx, viewerId, now)) + eligible.length > INVITES_PER_DAY_MAX) {
        throw apiError('invites_daily_limit');
      }
      const [pending] = await tx
        .select({ n: count() })
        .from(lobbyInvites)
        .where(and(eq(lobbyInvites.lobbyId, lobbyId), eq(lobbyInvites.status, 'pending')));
      if ((pending?.n ?? 0) + eligible.length > LOBBY_PENDING_INVITES_MAX)
        throw apiError('lobby_invites_limit');

      const inserted = await tx
        .insert(lobbyInvites)
        .values(
          eligible.map((p) => ({
            lobbyId,
            inviterId: viewerId,
            inviteeId: p.id,
            byHost: isHost,
            createdAt: now,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: lobbyInvites.id, inviteeId: lobbyInvites.inviteeId });
      const messages: OutboxMessage[] = [];
      for (const invite of inserted) {
        const person = eligible.find((p) => p.id === invite.inviteeId)!;
        if (!person.allowsWriteToPm) continue;
        if ((await this.inviteMessagesToday(tx, person.id, now)) >= INVITE_MESSAGES_PER_DAY_MAX) continue;
        messages.push({ kind: 'user_invite', userId: person.id, lobbyId, inviteId: invite.id });
      }
      await this.outbox.enqueue(tx, messages, now);
      return { sent: inserted.length, skipped: input.codes.length - inserted.length };
    });
  }

  private async inviteMessagesToday(db: Executor, userId: string, now: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.kind, 'user_invite'),
          gt(notifications.createdAt, new Date(now.getTime() - INVITES_WINDOW_HOURS * HOUR_MS)),
        ),
      );
    return row?.n ?? 0;
  }

  /** «Мои → Приглашения»: pending first, then the rest, newest first. */
  async mine(viewerId: string): Promise<MyInvitesResponse> {
    const items = await this.load(this.db, viewerId, this.clock.now());
    const rank = (i: MyInviteDto) => (i.state === 'pending' ? 0 : 1);
    return { items: items.sort((a, b) => rank(a) - rank(b)) };
  }

  /**
   * «Иду». A host's invite makes the invitee a member at once, past the karma threshold and the
   * application caps (it is not an application); a member's invite applies like the button.
   */
  async accept(viewerId: string, inviteId: string): Promise<InviteAnswerResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      await this.lobbies.lockActor(tx, viewerId);
      const invite = await this.ownInvite(tx, viewerId, inviteId);
      if (!(await lockLobby(tx, invite.lobbyId))) throw apiError('invite_not_found');
      const locked = await this.lockInvite(tx, inviteId);
      if (locked.status === 'accepted') return this.answer(tx, viewerId, inviteId, now);
      if (locked.status === 'declined') throw apiError('invite_answered');

      const viewer = await this.lobbies.viewer(tx, viewerId, now);
      if (!viewer.onboarded) throw apiError('not_onboarded');
      const { row, effectiveStatus } = await this.lobbies.visibleLobby(tx, invite.lobbyId, viewerId, now);
      const works = inviteWorks({ effectiveStatus, approvedCount: row.approvedCount, slots: row.slots });

      if (locked.byHost) {
        const membership = await lockOwnMembership(tx, invite.lobbyId, viewerId);
        if (membership?.status !== 'approved') {
          if ((membership && membership.status !== 'pending' && closesInvites(membership)) || !works) {
            throw apiError('invite_expired');
          }
          const approved = { status: 'approved' as const, decidedAt: now, inviteId, updatedAt: now };
          const [member] = membership
            ? await tx
                .update(lobbyMembers)
                .set({
                  ...approved,
                  // A withdrawn application comes back as a new one.
                  ...(membership.status === 'cancelled' ? { appliedAt: now, cancelledAt: null } : {}),
                })
                .where(eq(lobbyMembers.id, membership.id))
                .returning({ id: lobbyMembers.id })
            : await tx
                .insert(lobbyMembers)
                .values({
                  lobbyId: invite.lobbyId,
                  userId: viewerId,
                  appliedAt: now,
                  createdAt: now,
                  ...approved,
                })
                .returning({ id: lobbyMembers.id });
          // The exact address goes to the bot DM, as on the host's approval.
          await this.outbox.enqueue(
            tx,
            [{ kind: 'member_approved', userId: viewerId, lobbyId: invite.lobbyId, memberId: member!.id }],
            now,
          );
        }
      } else {
        if (!works) throw apiError('invite_expired');
        await this.applications.applyIn(tx, viewerId, invite.lobbyId, now, inviteId);
      }
      await tx
        .update(lobbyInvites)
        .set({ status: 'accepted', answeredAt: now })
        .where(eq(lobbyInvites.id, inviteId));
      return this.answer(tx, viewerId, inviteId, now);
    });
  }

  /** «Не смогу»; with `optOut` also «Не приглашать меня» (the profile toggle turns it back on). */
  async decline(viewerId: string, inviteId: string, optOut = false): Promise<InviteAnswerResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      await this.lobbies.lockActor(tx, viewerId);
      await this.ownInvite(tx, viewerId, inviteId);
      const locked = await this.lockInvite(tx, inviteId);
      if (locked.status === 'accepted') throw apiError('invite_answered');
      if (locked.status === 'pending') {
        await tx
          .update(lobbyInvites)
          .set({ status: 'declined', answeredAt: now })
          .where(eq(lobbyInvites.id, inviteId));
      }
      if (optOut) {
        await tx.update(users).set({ invitesEnabled: false, updatedAt: now }).where(eq(users.id, viewerId));
      }
      return this.answer(tx, viewerId, inviteId, now);
    });
  }

  /** The viewer's own invite; anyone else's, or one of a shadow-banned inviter, is a 404. */
  private async ownInvite(tx: DbTransaction, viewerId: string, inviteId: string) {
    const [invite] = await tx
      .select({ lobbyId: lobbyInvites.lobbyId })
      .from(lobbyInvites)
      .innerJoin(inviterUser, eq(inviterUser.id, lobbyInvites.inviterId))
      .where(
        and(
          eq(lobbyInvites.id, inviteId),
          eq(lobbyInvites.inviteeId, viewerId),
          not(inviterUser.isShadowBanned),
        ),
      );
    if (!invite) throw apiError('invite_not_found');
    return invite;
  }

  private async lockInvite(tx: DbTransaction, inviteId: string) {
    const [invite] = await tx
      .select({ status: lobbyInvites.status, byHost: lobbyInvites.byHost })
      .from(lobbyInvites)
      .where(eq(lobbyInvites.id, inviteId))
      .for('update');
    if (!invite) throw apiError('invite_not_found');
    return invite;
  }

  private async answer(
    db: Executor,
    viewerId: string,
    inviteId: string,
    now: Date,
  ): Promise<InviteAnswerResponse> {
    const [invite] = await this.load(db, viewerId, now, inviteId);
    if (!invite) throw apiError('invite_not_found');
    return { invite };
  }

  /** The viewer's invites whose lobby they can see; one of them with `inviteId`. */
  private async load(db: Executor, viewerId: string, now: Date, inviteId?: string): Promise<MyInviteDto[]> {
    const rows = await db
      .select({
        id: lobbyInvites.id,
        lobbyId: lobbyInvites.lobbyId,
        status: lobbyInvites.status,
        byHost: lobbyInvites.byHost,
        createdAt: lobbyInvites.createdAt,
        fromCode: inviterUser.publicCode,
        fromName: inviterUser.firstName,
        fromPhoto: inviterUser.photoUrl,
      })
      .from(lobbyInvites)
      .innerJoin(inviterUser, eq(inviterUser.id, lobbyInvites.inviterId))
      .where(
        and(
          eq(lobbyInvites.inviteeId, viewerId),
          not(inviterUser.isShadowBanned),
          inviteId ? eq(lobbyInvites.id, inviteId) : undefined,
        ),
      )
      .orderBy(desc(lobbyInvites.createdAt), desc(lobbyInvites.id))
      .limit(MY_INVITES_MAX);
    if (rows.length === 0) return [];
    const [cards, viewer] = await Promise.all([
      selectLobbyCards(db, viewerId).where(inArray(lobbies.id, [...new Set(rows.map((r) => r.lobbyId))])),
      this.lobbies.viewer(db, viewerId, now),
    ]);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const items: MyInviteDto[] = [];
    for (const row of rows) {
      const card = byId.get(row.lobbyId);
      if (!card) continue;
      const effectiveStatus = effectiveLobbyStatus(card, now);
      const access = resolveLobbyAccess({
        viewerId,
        hostId: card.hostId,
        hostShadowBanned: card.hostShadowBanned,
        viewerReported: card.viewerReported,
        membership: membershipOf(card),
        effectiveStatus,
      });
      if (!access.visible) continue;
      const works = inviteWorks({ effectiveStatus, approvedCount: card.approvedCount, slots: card.slots });
      items.push({
        id: row.id,
        state: row.status === 'pending' && !works ? 'expired' : row.status,
        byHost: row.byHost,
        from: { code: row.fromCode, firstName: row.fromName, photoUrl: row.fromPhoto },
        createdAt: row.createdAt.toISOString(),
        lobby: toLobbyCard(card, viewer, now),
      });
    }
    return items;
  }
}
