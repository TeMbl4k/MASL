import type { LobbyAccess, LobbyStatus, MembershipStatus } from '@masl/shared';

export interface LobbyAccessInput {
  viewerId: string;
  hostId: string;
  hostShadowBanned: boolean;
  membership: { status: MembershipStatus; decidedAt: Date | null } | null;
  effectiveStatus: LobbyStatus;
}

export interface LobbyAccessResult {
  /** False: the lobby answers exactly like a missing one (404). */
  visible: boolean;
  isHost: boolean;
  access: LobbyAccess;
  canSeeExactPlace: boolean;
  canSeeMembers: boolean;
  canManage: boolean;
}

/** Memberships that keep a shadow-banned host's lobby visible to the member. */
const KEEPS_VISIBLE: readonly MembershipStatus[] = ['pending', 'approved', 'attended', 'no_show'];
const SEES_MEMBERS: readonly MembershipStatus[] = ['approved', 'attended'];
const EXACT_PLACE_STATUSES: readonly LobbyStatus[] = ['open', 'active'];

/**
 * The one authorization rule of a lobby (spec §5.5). The exact place goes only to the host
 * and to approved members while the lobby is open or active.
 */
export function resolveLobbyAccess(i: LobbyAccessInput): LobbyAccessResult {
  const isHost = i.viewerId === i.hostId;
  const status = i.membership?.status ?? null;
  const visible = isHost || !i.hostShadowBanned || (status !== null && KEEPS_VISIBLE.includes(status));
  const canSeeExactPlace =
    isHost || (status === 'approved' && EXACT_PLACE_STATUSES.includes(i.effectiveStatus));
  const canSeeMembers = isHost || (status !== null && SEES_MEMBERS.includes(status));
  return {
    visible,
    isHost,
    access: isHost ? 'host' : canSeeExactPlace ? 'member' : 'public',
    canSeeExactPlace,
    canSeeMembers,
    canManage: isHost && i.effectiveStatus === 'open',
  };
}
