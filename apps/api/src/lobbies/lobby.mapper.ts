import {
  LOBBY_CANCEL_REASONS_OUT,
  attendanceDeadline,
  attendanceState,
  checkInOpensAt,
  effectiveLobbyStatus,
  hostLateCancelFrom,
  meetsMinKarma,
  roundDistance,
  APPLICATIONS_PENDING_MAX,
  APPLICATIONS_PER_DAY_MAX,
  NEWBIE_ATTENDED_MIN,
  type ApplicantDto,
  type ApplyBlockReason,
  type ExactPlaceDto,
  type LobbyAccess,
  type LobbyCancelReasonOut,
  type LobbyCardDto,
  type LobbyChatDto,
  type LobbyDetailDto,
  type LobbyStatus,
  type MembershipStatus,
  type PersonDto,
  type PublicPlaceDto,
} from '@masl/shared';
import { stationById } from '@masl/shared/metro';
import { z } from 'zod';
import type { GeoPoint } from '@masl/db';
import type { ApplicantRow, DetailExtrasRow, LobbyCardRow, ViewerContext } from './lobby-queries.js';

/**
 * Rows → DTOs. Every DTO is a new object with named fields; rows are never spread, so a column
 * added to a query can't reach a response by accident (the strict schemas back this up).
 */

const cancelReasonSchema = z.enum(LOBBY_CANCEL_REASONS_OUT).catch('other');

/** Stored cancel_reason → a known code; garbage reads as 'other'. */
export function parseCancelReason(value: string | null): LobbyCancelReasonOut | null {
  return value === null ? null : cancelReasonSchema.parse(value);
}

const point = (p: GeoPoint) => ({ lat: p.lat, lng: p.lng });

/** The public place: the station snapshot of the row, line data from the current dataset. */
export function toPublicPlace(row: {
  placeHint: string;
  metroStationId: string;
  publicLocation: GeoPoint;
  farFromMetro: boolean;
}): PublicPlaceDto {
  const entry = stationById(row.metroStationId);
  return {
    hint: row.placeHint,
    stationId: row.metroStationId,
    lineName: entry?.line.name ?? null,
    lineColor: entry?.line.color ?? null,
    point: point(row.publicLocation),
    farFromMetro: row.farFromMetro,
  };
}

export function toPerson(row: { firstName: string; photoUrl: string | null; karma: number }): PersonDto {
  return { firstName: row.firstName, photoUrl: row.photoUrl, karma: row.karma };
}

export function toExactPlace(row: { address: string; point: GeoPoint }): ExactPlaceDto {
  return { address: row.address, point: point(row.point) };
}

export interface ApplyBlockInput {
  isHost: boolean;
  effectiveStatus: LobbyStatus;
  membership: { status: MembershipStatus; decidedAt: Date | null } | null;
  minKarma: number | null;
  slots: number;
  approvedCount: number;
}

/**
 * The first failing apply check, in the order the apply flow runs them (spec §5.6); null when
 * apply is allowed or would be an idempotent repeat (pending or approved on an open lobby).
 */
export function applyBlock(viewer: ViewerContext, lobby: ApplyBlockInput): ApplyBlockReason | null {
  if (!viewer.onboarded) return 'not_onboarded';
  if (lobby.isHost) return 'own';
  if (lobby.effectiveStatus !== 'open') return 'not_open';
  const membership = lobby.membership;
  if (membership?.status === 'pending' || membership?.status === 'approved') return null;
  if (membership?.status === 'rejected') return 'rejected';
  if (membership?.status === 'cancelled' && membership.decidedAt !== null) return 'left';
  if (!meetsMinKarma(viewer.karma, lobby.minKarma)) return 'karma';
  if (lobby.approvedCount >= lobby.slots) return 'full';
  if (viewer.pendingApplications >= APPLICATIONS_PENDING_MAX) return 'pending_limit';
  if (viewer.applicationsInWindow >= APPLICATIONS_PER_DAY_MAX) return 'applications_daily_limit';
  return null;
}

export const membershipOf = (row: LobbyCardRow) =>
  row.memberStatus === null ? null : { status: row.memberStatus, decidedAt: row.memberDecidedAt };

/** A card as the viewer sees it at `now`. */
export function toLobbyCard(row: LobbyCardRow, viewer: ViewerContext, now: Date): LobbyCardDto {
  const status = effectiveLobbyStatus(row, now);
  const isHost = row.hostId === viewer.userId;
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status,
    slots: row.slots,
    approvedCount: row.approvedCount,
    pendingCount: isHost ? (row.pendingCount ?? 0) : null,
    minKarma: row.minKarma,
    paymentFormat: row.paymentFormat,
    place: toPublicPlace(row),
    distanceM: row.distanceM === null ? null : roundDistance(row.distanceM),
    host: toPerson({ firstName: row.hostFirstName, photoUrl: row.hostPhotoUrl, karma: row.hostKarma }),
    viewer: {
      isHost,
      membershipStatus: row.memberStatus,
      applyBlock: applyBlock(viewer, {
        isHost,
        effectiveStatus: status,
        membership: membershipOf(row),
        minKarma: row.minKarma,
        slots: row.slots,
        approvedCount: row.approvedCount,
      }),
      reported: row.viewerReported,
    },
  };
}

export type DetailAccess =
  | { access: Extract<LobbyAccess, 'public'> }
  | { access: Extract<LobbyAccess, 'member' | 'host'>; exactPlace: ExactPlaceDto };

/** Detail parts that depend on the viewer's role; each is null for anyone else. */
export type DetailExtras = Pick<LobbyDetailDto, 'chat' | 'cancelPolicy' | 'checkIn' | 'attendance'>;

export const NO_EXTRAS: DetailExtras = { chat: null, cancelPolicy: null, checkIn: null, attendance: null };

/**
 * The host gets the group, the cancel policy before the start and attendance after the end; an
 * approved member gets the group and «Я на месте» while the lobby is open or active. Everyone
 * else, and members after the end, get nulls.
 */
export function toDetailExtras(card: LobbyCardDto, row: DetailExtrasRow, now: Date): DetailExtras {
  const isHost = card.viewer.isHost;
  const status = card.status;
  const ongoing = status === 'open' || status === 'active';
  const memberOngoing = !isHost && card.viewer.membershipStatus === 'approved' && ongoing;
  const linked = row.chatId !== null && row.chatClosedAt === null;
  const chat: LobbyChatDto | null =
    (isHost && ongoing) || memberOngoing
      ? {
          state: linked ? 'linked' : 'none',
          title: linked ? row.chatTitle : null,
          inviteLink: linked ? row.chatInviteLink : null,
        }
      : null;
  return {
    chat,
    cancelPolicy:
      isHost && status === 'open'
        ? {
            lateFrom: hostLateCancelFrom(card.startsAt).toISOString(),
            quorumMet: card.approvedCount >= card.slots,
          }
        : null,
    checkIn: memberOngoing
      ? {
          opensAt: checkInOpensAt(card.startsAt).toISOString(),
          closesAt: card.endsAt,
          checkedInAt: row.checkedInAt?.toISOString() ?? null,
        }
      : null,
    attendance:
      isHost && status === 'finished'
        ? {
            state: attendanceState({ status, endsAt: card.endsAt, ...row }, now),
            deadline: attendanceDeadline(card.endsAt).toISOString(),
          }
        : null,
  };
}

/** The detail; `exactPlace` exists only for member and host access. */
export function toLobbyDetail(
  row: LobbyCardRow,
  viewer: ViewerContext,
  now: Date,
  access: DetailAccess,
  members: PersonDto[] | null,
  extrasRow: DetailExtrasRow | null = null,
): LobbyDetailDto {
  const card = toLobbyCard(row, viewer, now);
  const extras = extrasRow ? toDetailExtras(card, extrasRow, now) : NO_EXTRAS;
  const base = {
    ...card,
    description: row.description,
    cancelReason: parseCancelReason(row.cancelReason),
    cancelComment: row.cancelComment,
    members,
    chat: extras.chat,
    cancelPolicy: extras.cancelPolicy,
    checkIn: extras.checkIn,
    attendance: extras.attendance,
  };
  return access.access === 'public'
    ? { ...base, access: 'public' }
    : { ...base, access: access.access, exactPlace: access.exactPlace };
}

/** An application as the host sees it: public person data, karma and the newbie flag only. */
export function toApplicant(row: ApplicantRow, minKarma: number | null): ApplicantDto {
  return {
    applicationId: row.id,
    status: row.status,
    appliedAt: row.appliedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    user: {
      firstName: row.firstName,
      photoUrl: row.photoUrl,
      karma: row.karma,
      isNewbie: row.attended < NEWBIE_ATTENDED_MIN,
    },
    meetsMinKarma: meetsMinKarma(row.karma, minKarma),
  };
}
