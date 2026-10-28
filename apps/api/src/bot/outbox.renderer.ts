import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, max, sql } from 'drizzle-orm';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'grammy/types';
import { InputFile, type RawApi } from 'grammy';
import {
  broadcasts,
  karmaEvents,
  linkTags,
  lobbies,
  lobbyFeedback,
  lobbyInvites,
  lobbyMembers,
  moderationCases,
  notifications,
  reports,
  supportRequests,
  userAchievements,
  userArrivals,
  users,
  type Database,
  type Notification,
} from '@masl/db';
import {
  ACHIEVEMENTS,
  FEEDBACK_MEMBERSHIP_STATUSES,
  NEWBIE_ATTENDED_MIN,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  SUPPORT_CATEGORY_LABELS,
  appealRetryAt,
  attendanceDeadline,
  attendanceState,
  effectiveLobbyStatus,
  lowerMinKarma,
  achievementProgress,
  nextAchievement,
  type FeedbackRating,
  type LobbyStatus,
  type MembershipStatus,
} from '@masl/shared';
import { qrSvgDocument } from '@masl/shared/qr';
import { loadAchievementMetrics, loadEarnedIds } from '../achievements/achievement-queries.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { inviteWorks, inviterUser } from '../invites/invite-queries.js';
import { hostUser } from '../lobbies/lobby-queries.js';
import { parseCancelReason } from '../lobbies/lobby.mapper.js';
import { userRole } from '../moderation/roles.js';
import { areCompanions } from '../people/companions.js';
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
  | 'sendMessage'
  | 'sendVenue'
  | 'sendDocument'
  | 'revokeChatInviteLink'
  | 'banChatMember'
  | 'unbanChatMember'
  | 'leaveChat';

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
  placeHint: lobbies.placeHint,
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

/** A private message as Bot API calls: the text, then the venue if any. */
function privateCalls(chatId: number, message: PrivateMessage): TelegramCall[] {
  const calls: TelegramCall[] = [
    {
      method: 'sendMessage',
      payload: {
        chat_id: chatId,
        text: message.text,
        reply_markup: message.markup,
        link_preview_options: { is_disabled: true },
      },
    },
  ];
  if (message.venue) calls.push({ method: 'sendVenue', payload: { chat_id: chatId, ...message.venue } });
  return calls;
}

/** The QR of `link` as an SVG file to print. */
function qrDocument(chatId: number, link: string, filename: string, caption: string): TelegramCall {
  return {
    method: 'sendDocument',
    payload: {
      chat_id: chatId,
      document: new InputFile(Buffer.from(qrSvgDocument(link), 'utf8'), filename),
      caption,
    },
  };
}

/** A broadcast's buttons: the meetup or the app, and «Отписаться от новостей». */
export async function broadcastMarkup(
  links: AppLinks,
  lobbyId: string | null,
  broadcastId: string | null,
): Promise<InlineKeyboardMarkup | undefined> {
  return keyboard([
    [
      lobbyId
        ? await links.button(texts.broadcastOpenLobby, appPaths.lobby(lobbyId))
        : await links.button(texts.broadcastOpenApp, appPaths.feed()),
    ],
    [{ text: texts.newsOff, callback_data: encodeCallback({ action: 'news_off', broadcastId }) }],
  ]);
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
    if (row.supportId !== null) return this.renderSupport(row, row.supportId);
    if (row.broadcastId !== null) return this.renderBroadcast(row, row.broadcastId);
    if (row.lobbyId === null) return this.renderAboutRecipient(row);
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
    return message ? privateCalls(user.telegramId, message) : null;
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
      case 'user_invite': {
        if (row.inviteId === null) return null;
        if (
          !inviteWorks({ effectiveStatus: status, approvedCount: lobby.approvedCount, slots: lobby.slots })
        ) {
          return null;
        }
        const [invite] = await this.db
          .select({
            status: lobbyInvites.status,
            byHost: lobbyInvites.byHost,
            from: inviterUser.firstName,
            inviterBanned: inviterUser.isShadowBanned,
            hostBanned: hostUser.isShadowBanned,
            invitesEnabled: users.invitesEnabled,
          })
          .from(lobbyInvites)
          .innerJoin(inviterUser, eq(inviterUser.id, lobbyInvites.inviterId))
          .innerJoin(users, eq(users.id, lobbyInvites.inviteeId))
          .innerJoin(lobbies, eq(lobbies.id, lobbyInvites.lobbyId))
          .innerJoin(hostUser, eq(hostUser.id, lobbies.hostId))
          .where(eq(lobbyInvites.id, row.inviteId));
        if (!invite || invite.status !== 'pending' || !invite.invitesEnabled) return null;
        if (invite.inviterBanned || invite.hostBanned) return null;
        const button = (text: string, action: 'invite_accept' | 'invite_decline' | 'invite_opt_out') => ({
          text,
          callback_data: encodeCallback({ action, inviteId: row.inviteId! }),
        });
        return {
          text: texts.userInvite(
            { ...lobby, free: lobby.slots - lobby.approvedCount, slots: lobby.slots },
            invite.from,
            invite.byHost,
          ),
          markup: keyboard([
            [button(texts.inviteAccept, 'invite_accept'), button(texts.inviteDecline, 'invite_decline')],
            [button(texts.inviteOptOut, 'invite_opt_out')],
            [await appButton('Открыть встречу', appPaths.lobby(lobby.id))],
          ]),
        };
      }
      case 'user_friend_counted': {
        if (member?.status !== 'attended' || row.userId === null) return null;
        const recipientId = row.userId;
        const [companion, arrived, metrics] = await Promise.all([
          areCompanions(this.db, recipientId, member.userId),
          this.db
            .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
            .from(userArrivals)
            .where(eq(userArrivals.referrerId, recipientId)),
          loadAchievementMetrics(this.db, recipientId),
        ]);
        return {
          text: texts.userFriendCounted(
            companion ? member.firstName : null,
            arrived[0]?.n ?? 0,
            metrics.friends,
          ),
          markup: keyboard([[await appButton(texts.achievementsButton, appPaths.achievements())]]),
        };
      }
      default:
        return null;
    }
  }

  /**
   * Messages about the recipient themselves (stage 7): new achievements since the last such
   * message, the QR card or a link tag's QR as an SVG file.
   */
  private async renderAboutRecipient(row: Notification): Promise<TelegramCall[] | null> {
    if (row.userId === null) return null;
    const [recipient] = await this.db
      .select({
        telegramId: users.telegramId,
        isModerator: users.isModerator,
        publicCode: users.publicCode,
      })
      .from(users)
      .where(eq(users.id, row.userId));
    if (!recipient) return null;
    switch (row.kind) {
      case 'user_achievements': {
        const earned = await this.unannouncedAchievements(row.userId);
        if (earned.length === 0) return null;
        const metrics = await loadAchievementMetrics(this.db, row.userId);
        const next = nextAchievement(metrics, new Set(await loadEarnedIds(this.db, row.userId)));
        return privateCalls(recipient.telegramId, {
          text: texts.userAchievements(earned, next && { id: next, ...achievementProgress(metrics, next) }),
          markup: keyboard([[await this.links.button(texts.achievementsButton, appPaths.achievements())]]),
        });
      }
      case 'user_qr_print': {
        const link = await this.links.profileLink(recipient.publicCode);
        if (link === null) return null;
        return [
          qrDocument(recipient.telegramId, link, `masl-qr-${recipient.publicCode}.svg`, texts.userQrPrint),
        ];
      }
      case 'admin_tag_qr_print': {
        if (row.tagId === null || userRole(recipient, this.env.ADMIN_TELEGRAM_IDS) !== 'admin') return null;
        const [tag] = await this.db
          .select({ slug: linkTags.slug, title: linkTags.title })
          .from(linkTags)
          .where(eq(linkTags.id, row.tagId));
        const link = tag ? await this.links.tagLink(tag.slug) : null;
        if (!tag || link === null) return null;
        return [
          qrDocument(recipient.telegramId, link, `masl-qr-${tag.slug}.svg`, texts.adminTagQrPrint(tag.title)),
        ];
      }
      default:
        return null;
    }
  }

  /**
   * An admin's broadcast while the recipient still wants news. Plain text with the action and
   * «Отписаться от новостей».
   */
  private async renderBroadcast(row: Notification, broadcastId: string): Promise<TelegramCall[] | null> {
    if (row.userId === null) return null;
    const [recipient] = await this.db
      .select({ telegramId: users.telegramId, newsEnabled: users.newsEnabled })
      .from(users)
      .where(eq(users.id, row.userId));
    const [broadcast] = await this.db
      .select({ text: broadcasts.text, lobbyId: broadcasts.lobbyId })
      .from(broadcasts)
      .where(eq(broadcasts.id, broadcastId));
    if (!recipient?.newsEnabled || !broadcast) return null;
    return privateCalls(recipient.telegramId, {
      text: broadcast.text,
      markup: await broadcastMarkup(this.links, broadcast.lobbyId, broadcastId),
    });
  }

  /** Achievements earned since the last achievements message went out, the backfill's aside. */
  private async unannouncedAchievements(userId: string) {
    const [last] = await this.db
      .select({ at: max(notifications.sentAt) })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.kind, 'user_achievements'),
          isNotNull(notifications.sentAt),
        ),
      );
    const rows = await this.db
      .select({ id: userAchievements.achievement })
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.userId, userId),
          eq(userAchievements.silent, false),
          last?.at ? gt(userAchievements.earnedAt, last.at) : undefined,
        ),
      );
    const ids = new Set(rows.map((r) => r.id));
    return ACHIEVEMENTS.filter((id) => ids.has(id));
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
    return privateCalls(recipient.telegramId, message);
  }

  /**
   * «Написать нам» (stage 6): a new request to an admin while it is open and they are still an
   * admin; the reply to its author.
   */
  private async renderSupport(row: Notification, supportId: string): Promise<TelegramCall[] | null> {
    const [request] = await this.db
      .select({
        authorId: supportRequests.authorId,
        category: supportRequests.category,
        text: supportRequests.text,
        reply: supportRequests.reply,
        closedAt: supportRequests.closedAt,
        authorFirstName: users.firstName,
      })
      .from(supportRequests)
      .innerJoin(users, eq(users.id, supportRequests.authorId))
      .where(eq(supportRequests.id, supportId));
    const [recipient] = await this.db
      .select({ telegramId: users.telegramId, isModerator: users.isModerator })
      .from(users)
      .where(eq(users.id, row.userId!));
    if (!request || !recipient) return null;
    let message: PrivateMessage;
    if (row.kind === 'admin_new_support') {
      if (request.closedAt !== null || userRole(recipient, this.env.ADMIN_TELEGRAM_IDS) !== 'admin')
        return null;
      message = {
        text: texts.adminNewSupport(
          SUPPORT_CATEGORY_LABELS[request.category],
          request.authorFirstName,
          request.text,
        ),
        markup: keyboard([[await this.links.button('Открыть обращения', appPaths.adminSupport())]]),
      };
    } else if (row.kind === 'user_support_reply') {
      if (request.reply === null || row.userId !== request.authorId) return null;
      message = { text: texts.userSupportReply(request.reply) };
    } else {
      return null;
    }
    return privateCalls(recipient.telegramId, message);
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
