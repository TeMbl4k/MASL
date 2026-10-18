import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, max, sql } from 'drizzle-orm';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'grammy/types';
import type { RawApi } from 'grammy';
import {
  karmaEvents,
  lobbies,
  lobbyFeedback,
  lobbyMembers,
  moderationCases,
  notifications,
  reports,
  users,
  type Database,
  type Notification,
} from '@masl/db';
import {
  FEEDBACK_MEMBERSHIP_STATUSES,
  NEWBIE_ATTENDED_MIN,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  appealRetryAt,
  attendanceDeadline,
  attendanceState,
  effectiveLobbyStatus,
  lowerMinKarma,
  type FeedbackRating,
  type LobbyStatus,
  type MembershipStatus,
} from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { parseCancelReason } from '../lobbies/lobby.mapper.js';
import { userRole } from '../moderation/roles.js';
import {
  approvedCountSql,
  attendedCountSql,
  type Executor,
  visibleToHostSql,
} from '../lobbies/lobby-queries.js';
import { AppLinks, appPaths } from './app-links.js';
import { encodeCallback } from './callbacks.js';
import { texts } from './messages.js';

/** Bot API methods the outbox sends. */
type OutboxMethod =
  'sendMessage' | 'sendVenue' | 'revokeChatInviteLink' | 'banChatMember' | 'unbanChatMember' | 'leaveChat';

export type TelegramCall = {
  [M in OutboxMethod]: { method: M; payload: Parameters<RawApi[M]>[0] };
}[OutboxMethod];

/** Up to this many members get toggles right in the attendance poll; more go to the app. */
export const ATTENDANCE_POLL_MAX_MEMBERS = 10;

const OPEN_OR_ACTIVE: readonly LobbyStatus[] = ['open', 'active'];

const lobbyColumns = {
  id: lobbies.id,
  hostId: lobbies.hostId,
  title: lobbies.title,
  startsAt: lobbies.startsAt,
  endsAt: lobbies.endsAt,
  status: lobbies.status,
  slots: lobbies.slots,
  minKarma: lobbies.minKarma,
  cancelReason: lobbies.cancelReason,
  cancelComment: lobbies.cancelComment,
  chatId: lobbies.chatId,
  chatInviteLink: lobbies.chatInviteLink,
  chatClosedAt: lobbies.chatClosedAt,
  attendanceSavedAt: lobbies.attendanceSavedAt,
  attendanceClosedAt: lobbies.attendanceClosedAt,
  approvedCount: approvedCountSql,
};

type LobbyRow = Awaited<ReturnType<typeof loadLobby>>;

function loadLobby(db: Executor, lobbyId: string) {
  return db
    .select(lobbyColumns)
    .from(lobbies)
    .where(eq(lobbies.id, lobbyId))
    .then((rows) => rows[0] ?? null);
}

/** The lobby's linked group, while the bot still serves it. */
const activeChat = (lobby: NonNullable<LobbyRow>) =>
  lobby.chatId !== null && lobby.chatClosedAt === null ? lobby.chatId : null;

const keyboard = (rows: (InlineKeyboardButton | null)[][]): InlineKeyboardMarkup | undefined => {
  const kept = rows
    .map((row) => row.filter((b): b is InlineKeyboardButton => b !== null))
    .filter((r) => r.length);
  return kept.length > 0 ? { inline_keyboard: kept } : undefined;
};

export interface AttendancePollMember {
  memberId: string;
  firstName: string;
  checkedIn: boolean;
  absent: boolean;
}

/** Toggles, save and the app button of the attendance poll; also re-rendered after each tap. */
export function attendancePollMarkup(
  lobbyId: string,
  members: AttendancePollMember[],
  appButton: InlineKeyboardButton | null,
): InlineKeyboardMarkup | undefined {
  const many = members.length > ATTENDANCE_POLL_MAX_MEMBERS;
  const absent = members.filter((m) => m.absent && !m.checkedIn).length;
  return keyboard([
    ...(many
      ? []
      : members.map((m) => [
          {
            text: `${m.absent && !m.checkedIn ? '✗ не было' : '✓ на встрече'} · ${m.firstName}${m.checkedIn ? ' · на месте' : ''}`,
            callback_data: encodeCallback({ action: 'attendance_toggle', memberId: m.memberId }),
          },
        ])),
    many
      ? []
      : [
          {
            text: texts.attendanceSave(members.length - absent, absent),
            callback_data: encodeCallback({ action: 'attendance_save', lobbyId }),
          },
        ],
    [appButton],
  ]);
}

/** Approved members in the order they were admitted, for the attendance poll. */
export function loadPollMembers(db: Executor, lobbyId: string): Promise<AttendancePollMember[]> {
  return db
    .select({
      memberId: lobbyMembers.id,
      firstName: users.firstName,
      checkedIn: sql<boolean>`${lobbyMembers.checkedInAt} is not null`.mapWith(Boolean),
      absent: lobbyMembers.attendanceAbsentDraft,
    })
    .from(lobbyMembers)
    .innerJoin(users, eq(users.id, lobbyMembers.userId))
    .where(and(eq(lobbyMembers.lobbyId, lobbyId), eq(lobbyMembers.status, 'approved')))
    .orderBy(asc(lobbyMembers.decidedAt), asc(lobbyMembers.id));
}

interface PrivateMessage {
  text: string;
  markup?: InlineKeyboardMarkup;
  venue?: { latitude: number; longitude: number; title: string; address: string };
}

/**
 * Turns an outbox row into Bot API calls from the current rows; null skips a message that is no
 * longer true (the member left, the lobby was cancelled, attendance was saved). The exact
 * address is read only for member_approved, after the membership check, and never for a group.
 */
@Injectable()
export class OutboxRenderer {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AppLinks) private readonly links: AppLinks,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async render(row: Notification): Promise<TelegramCall[] | null> {
    if (row.caseId !== null) return this.renderCase(row, row.caseId);
    if (row.lobbyId === null) return null;
    const lobby = await loadLobby(this.db, row.lobbyId);
    if (!lobby) return null;
    const status = effectiveLobbyStatus(lobby, this.clock.now());
    if (row.chatId !== null) return this.renderGroup(row, row.chatId, lobby, status);

    const [user] = await this.db
      .select({ telegramId: users.telegramId })
      .from(users)
      .where(eq(users.id, row.userId!));
    if (!user) return null;
    const message = await this.renderPrivate(row, lobby, status);
    if (!message) return null;
    const calls: TelegramCall[] = [
      {
        method: 'sendMessage',
        payload: {
          chat_id: user.telegramId,
          text: message.text,
          reply_markup: message.markup,
          link_preview_options: { is_disabled: true },
        },
      },
    ];
    if (message.venue) {
      calls.push({ method: 'sendVenue', payload: { chat_id: user.telegramId, ...message.venue } });
    }
    return calls;
  }

  private async renderPrivate(
    row: Notification,
    lobby: NonNullable<LobbyRow>,
    status: LobbyStatus,
  ): Promise<PrivateMessage | null> {
    const now = this.clock.now();
    const member = row.memberId ? await this.memberOf(row.memberId) : null;
    const counts = { slots: lobby.slots, approved: lobby.approvedCount };
    const appButton = (text: string, path: string) => this.links.button(text, path);

    switch (row.kind) {
      case 'host_new_applications': {
        if (status !== 'open') return null;
        const applicants = await this.newApplicants(lobby.id);
        if (applicants.length === 0) return null;
        return {
          text: texts.hostNewApplications({ ...lobby, ...counts }, applicants),
          markup: keyboard([[await appButton('Открыть заявки', appPaths.applications(lobby.id))]]),
        };
      }
      case 'host_member_left': {
        if (member?.status !== 'cancelled' || status !== 'open') return null;
        return {
          text: texts.hostMemberLeft({ ...lobby, ...counts }, member.firstName),
          markup: keyboard([[await appButton('Открыть заявки', appPaths.applications(lobby.id))]]),
        };
      }
      case 'host_quorum_check': {
        if (status !== 'open' || lobby.approvedCount >= lobby.slots) return null;
        return { text: texts.hostQuorumCheck({ ...lobby, ...counts }), markup: quorumMarkup(lobby) };
      }
      case 'host_attendance_poll': {
        if (attendanceState(lobby, now) !== 'open') return null;
        const members = await loadPollMembers(this.db, lobby.id);
        if (members.length === 0) return null;
        const deadline = attendanceDeadline(lobby.endsAt);
        return {
          text: texts.hostAttendancePoll(lobby, deadline, members.length > ATTENDANCE_POLL_MAX_MEMBERS),
          markup: attendancePollMarkup(
            lobby.id,
            members,
            await appButton('Открыть список', appPaths.attendance(lobby.id)),
          ),
        };
      }
      case 'host_attendance_reminder': {
        if (attendanceState(lobby, now) !== 'open') return null;
        return {
          text: texts.hostAttendanceReminder(lobby.title, attendanceDeadline(lobby.endsAt)),
          markup: keyboard([[await appButton('Отметить', appPaths.attendance(lobby.id))]]),
        };
      }
      case 'member_approved': {
        if (member?.status !== 'approved' || !OPEN_OR_ACTIVE.includes(status)) return null;
        const [place] = await this.db
          .select({ address: lobbies.address, point: lobbies.location })
          .from(lobbies)
          .where(eq(lobbies.id, lobby.id));
        if (!place) return null;
        const chat = activeChat(lobby) !== null ? lobby.chatInviteLink : null;
        return {
          text: texts.memberApproved({ ...lobby, address: place.address }),
          markup: keyboard([
            [chat ? { text: 'Чат встречи', url: chat } : null],
            [await appButton('Открыть встречу', appPaths.lobby(lobby.id))],
          ]),
          venue: {
            latitude: place.point.lat,
            longitude: place.point.lng,
            title: lobby.title,
            address: place.address,
          },
        };
      }
      case 'member_rejected': {
        if (member?.status !== 'rejected') return null;
        return {
          text: texts.memberRejected(lobby.title),
          markup: keyboard([[await appButton('Найти встречу', appPaths.feed())]]),
        };
      }
      case 'member_lobby_cancelled': {
        if (lobby.status !== 'cancelled') return null;
        return {
          text: texts.memberLobbyCancelled(lobby, parseCancelReason(lobby.cancelReason), lobby.cancelComment),
        };
      }
      case 'member_chat_ready': {
        const link = activeChat(lobby) !== null ? lobby.chatInviteLink : null;
        if (member?.status !== 'approved' || member.chatJoinedAt !== null || link === null) return null;
        if (!OPEN_OR_ACTIVE.includes(status)) return null;
        return {
          text: texts.memberChatReady(lobby.title),
          markup: keyboard([[{ text: 'Вступить в чат', url: link }]]),
        };
      }
      case 'member_attendance_result': {
        if (member?.status !== 'attended' && member?.status !== 'no_show') return null;
        const [event] = await this.db
          .select({ delta: karmaEvents.delta })
          .from(karmaEvents)
          .where(
            and(
              eq(karmaEvents.userId, member.userId),
              eq(karmaEvents.lobbyId, lobby.id),
              inArray(karmaEvents.reason, ['attended', 'no_show']),
            ),
          );
        if (!event) return null;
        const outcome =
          member.status === 'no_show' ? 'no_show' : lobby.attendanceSavedAt ? 'attended' : 'checked_in';
        return { text: texts.memberAttendanceResult(lobby.title, outcome, event.delta) };
      }
      case 'member_feedback_request': {
        if (!member || !FEEDBACK_STATUSES.includes(member.status) || lobby.attendanceClosedAt !== null) {
          return null;
        }
        const [answered] = await this.db
          .select({ rating: lobbyFeedback.rating })
          .from(lobbyFeedback)
          .where(and(eq(lobbyFeedback.lobbyId, lobby.id), eq(lobbyFeedback.userId, member.userId)));
        if (answered) return null;
        const [host] = await this.db
          .select({ firstName: users.firstName })
          .from(users)
          .where(eq(users.id, lobby.hostId));
        const button = (text: string, rating: FeedbackRating) => ({
          text,
          callback_data: encodeCallback({ action: 'feedback', lobbyId: lobby.id, rating }),
        });
        return {
          text: texts.memberFeedbackRequest(lobby.title, host?.firstName ?? 'хоста'),
          markup: keyboard([
            [button('Хорошо', 'good'), button('Плохо', 'bad')],
            [button('Не состоялась', 'not_held')],
          ]),
        };
      }
      default:
        return null;
    }
  }

  private async renderGroup(
    row: Notification,
    chatId: number,
    lobby: NonNullable<LobbyRow>,
    status: LobbyStatus,
  ): Promise<TelegramCall[] | null> {
    // The scheduler closes the chat in the same step that queues the leave.
    if (row.kind === 'group_leave') return [{ method: 'leaveChat', payload: { chat_id: chatId } }];
    if (activeChat(lobby) !== chatId) return null;
    const send = (text: string): TelegramCall => ({
      method: 'sendMessage',
      payload: { chat_id: chatId, text },
    });
    const revoke: TelegramCall[] = lobby.chatInviteLink
      ? [{ method: 'revokeChatInviteLink', payload: { chat_id: chatId, invite_link: lobby.chatInviteLink } }]
      : [];

    switch (row.kind) {
      case 'group_welcome':
        return OPEN_OR_ACTIVE.includes(status) ? [send(texts.groupWelcome(lobby))] : null;
      case 'group_finished':
        return [...revoke, send(texts.groupFinished(lobby.title))];
      case 'group_cancelled':
        return [...revoke, send(texts.groupCancelled(lobby.title))];
      case 'group_kick': {
        const member = row.memberId ? await this.memberOf(row.memberId) : null;
        if (!member || member.status === 'approved') return null;
        return [
          { method: 'banChatMember', payload: { chat_id: chatId, user_id: member.telegramId } },
          {
            method: 'unbanChatMember',
            payload: { chat_id: chatId, user_id: member.telegramId, only_if_banned: true },
          },
        ];
      }
      default:
        return null;
    }
  }

  /**
   * Moderation messages (stage 4 §5): a new case to moderators while they still are moderators
   * and the case is open; an appeal's outcome to its author. Reporters and report comments are
   * never in them.
   */
  private async renderCase(row: Notification, caseId: string): Promise<TelegramCall[] | null> {
    const [kase] = await this.db
      .select({
        kind: moderationCases.kind,
        subjectId: moderationCases.subjectId,
        lobbyId: moderationCases.lobbyId,
        resolvedAt: moderationCases.resolvedAt,
        decision: moderationCases.decision,
        decisionComment: moderationCases.decisionComment,
        subjectFirstName: users.firstName,
      })
      .from(moderationCases)
      .innerJoin(users, eq(users.id, moderationCases.subjectId))
      .where(eq(moderationCases.id, caseId));
    const [recipient] = await this.db
      .select({ telegramId: users.telegramId, isModerator: users.isModerator })
      .from(users)
      .where(eq(users.id, row.userId!));
    if (!kase || !recipient) return null;
    let message: PrivateMessage | null = null;
    switch (row.kind) {
      case 'moderator_new_case': {
        if (kase.resolvedAt !== null || userRole(recipient, this.env.ADMIN_TELEGRAM_IDS) === 'user')
          return null;
        const text = await this.newCaseText(caseId, kase);
        if (text === null) return null;
        message = {
          text,
          markup: keyboard([[await this.links.button('Открыть', appPaths.adminCase(caseId))]]),
        };
        break;
      }
      case 'user_appeal_approved': {
        if (kase.decision !== 'appeal_approved' || row.userId !== kase.subjectId) return null;
        const [refund] =
          kase.lobbyId === null
            ? []
            : await this.db
                .select({ delta: karmaEvents.delta })
                .from(karmaEvents)
                .where(
                  and(
                    eq(karmaEvents.userId, kase.subjectId),
                    eq(karmaEvents.lobbyId, kase.lobbyId),
                    eq(karmaEvents.reason, 'appeal_refund'),
                  ),
                );
        message = {
          text: texts.userAppealApproved(refund?.delta ?? null),
          markup: keyboard([[await this.links.button('Открыть профиль', appPaths.profile())]]),
        };
        break;
      }
      case 'user_appeal_rejected': {
        if (
          kase.decision !== 'appeal_rejected' ||
          kase.resolvedAt === null ||
          row.userId !== kase.subjectId
        ) {
          return null;
        }
        message = {
          text: texts.userAppealRejected(kase.decisionComment ?? '', appealRetryAt(kase.resolvedAt)),
          markup: keyboard([[await this.links.button('Открыть профиль', appPaths.profile())]]),
        };
        break;
      }
      default:
        return null;
    }
    return [
      {
        method: 'sendMessage',
        payload: {
          chat_id: recipient.telegramId,
          text: message.text,
          reply_markup: message.markup,
          link_preview_options: { is_disabled: true },
        },
      },
    ];
  }

  private async newCaseText(
    caseId: string,
    kase: { kind: string; lobbyId: string | null; subjectFirstName: string },
  ): Promise<string | null> {
    if (kase.kind === 'appeal') return texts.moderatorAppeal(kase.subjectFirstName);
    if (kase.kind === 'not_held') {
      if (kase.lobbyId === null) return null;
      const [lobby] = await this.db
        .select({ title: lobbies.title })
        .from(lobbies)
        .where(eq(lobbies.id, kase.lobbyId));
      return lobby ? texts.moderatorNotHeld(lobby.title) : null;
    }
    const rows = await this.db
      .select({ reason: reports.reason })
      .from(reports)
      .where(eq(reports.caseId, caseId));
    const reasons = REPORT_REASONS.filter((r) => rows.some((row) => row.reason === r)).map((r) =>
      REPORT_REASON_LABELS[r].toLowerCase(),
    );
    return texts.moderatorShadowBan(kase.subjectFirstName, rows.length, reasons);
  }

  private async memberOf(memberId: string) {
    const [member] = await this.db
      .select({
        userId: lobbyMembers.userId,
        status: lobbyMembers.status,
        chatJoinedAt: lobbyMembers.chatJoinedAt,
        firstName: users.firstName,
        telegramId: users.telegramId,
      })
      .from(lobbyMembers)
      .innerJoin(users, eq(users.id, lobbyMembers.userId))
      .where(eq(lobbyMembers.id, memberId));
    return member ?? null;
  }

  /**
   * Pending applications the host sees (shadow-banned applicants stay hidden), applied after the
   * last applications message for this lobby went out.
   */
  private async newApplicants(lobbyId: string) {
    const [last] = await this.db
      .select({ at: max(notifications.sentAt) })
      .from(notifications)
      .where(
        and(
          eq(notifications.lobbyId, lobbyId),
          eq(notifications.kind, 'host_new_applications'),
          isNotNull(notifications.sentAt),
        ),
      );
    const rows = await this.db
      .select({ firstName: users.firstName, karma: users.karma, attended: attendedCountSql })
      .from(lobbyMembers)
      .innerJoin(users, eq(users.id, lobbyMembers.userId))
      .where(
        and(
          eq(lobbyMembers.lobbyId, lobbyId),
          eq(lobbyMembers.status, 'pending'),
          visibleToHostSql,
          last?.at ? gt(lobbyMembers.appliedAt, last.at) : undefined,
        ),
      )
      .orderBy(asc(lobbyMembers.appliedAt), asc(lobbyMembers.id));
    return rows.map((r) => ({
      firstName: r.firstName,
      karma: r.karma,
      isNewbie: r.attended < NEWBIE_ATTENDED_MIN,
    }));
  }
}

const FEEDBACK_STATUSES: readonly MembershipStatus[] = FEEDBACK_MEMBERSHIP_STATUSES;

/** Buttons of the quorum check; the threshold button only while there is a threshold. */
export function quorumMarkup(lobby: {
  id: string;
  minKarma: number | null;
}): InlineKeyboardMarkup | undefined {
  const lower = lobby.minKarma === null ? undefined : lowerMinKarma(lobby.minKarma);
  return keyboard([
    [
      lower === undefined
        ? null
        : {
            text: texts.quorumLower(lower),
            callback_data: encodeCallback({ action: 'quorum_lower', lobbyId: lobby.id }),
          },
    ],
    [
      {
        text: 'Отменить встречу',
        callback_data: encodeCallback({ action: 'quorum_cancel', lobbyId: lobby.id }),
      },
    ],
    [
      {
        text: 'Проводим как есть',
        callback_data: encodeCallback({ action: 'quorum_keep', lobbyId: lobby.id }),
      },
    ],
  ]);
}
