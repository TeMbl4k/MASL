import { LOBBY_STATUSES, type LobbyStatus, type MembershipStatus } from '@masl/shared';
import { resolveLobbyAccess, type LobbyAccessInput } from './lobby-access.js';

const HOST = 'host-id';
const VIEWER = 'viewer-id';
const DECIDED = new Date('2026-10-17T10:00:00.000Z');

/** Every membership state the access rule can meet, "left" and a withdrawn application apart. */
const MEMBERSHIPS: Record<string, LobbyAccessInput['membership']> = {
  none: null,
  pending: { status: 'pending', decidedAt: null },
  approved: { status: 'approved', decidedAt: DECIDED },
  rejected: { status: 'rejected', decidedAt: DECIDED },
  withdrawn: { status: 'cancelled', decidedAt: null },
  left: { status: 'cancelled', decidedAt: DECIDED },
  attended: { status: 'attended', decidedAt: DECIDED },
  no_show: { status: 'no_show', decidedAt: DECIDED },
};

/** Expectations straight from the access matrix of spec §5.5, per membership state (stage 4: reports too). */
const KEEPS_BANNED_HOST_VISIBLE = new Set(['pending', 'approved', 'attended', 'no_show']);
const SEES_MEMBERS = new Set(['approved', 'attended']);

describe('resolveLobbyAccess (T-ACC-1)', () => {
  const cases: [string, LobbyStatus, boolean, boolean][] = [];
  for (const name of Object.keys(MEMBERSHIPS)) {
    for (const status of LOBBY_STATUSES) {
      for (const banned of [false, true]) {
        for (const reported of [false, true]) cases.push([name, status, banned, reported]);
      }
    }
  }

  it.each(cases)(
    'non-host, membership %s, lobby %s, host banned %s, reported %s',
    (name, status, banned, reported) => {
      const result = resolveLobbyAccess({
        viewerId: VIEWER,
        hostId: HOST,
        hostShadowBanned: banned,
        viewerReported: reported,
        membership: MEMBERSHIPS[name]!,
        effectiveStatus: status,
      });
      const exact = name === 'approved' && (status === 'open' || status === 'active');
      expect(result).toEqual({
        visible: (!banned && !reported) || KEEPS_BANNED_HOST_VISIBLE.has(name),
        isHost: false,
        access: exact ? 'member' : 'public',
        canSeeExactPlace: exact,
        canSeeMembers: SEES_MEMBERS.has(name),
        canManage: false,
      });
    },
  );

  it.each(LOBBY_STATUSES.flatMap((status) => [false, true].map((banned) => [status, banned] as const)))(
    'host, lobby %s, banned %s: always visible, exact place and members',
    (status, banned) => {
      expect(
        resolveLobbyAccess({
          viewerId: HOST,
          hostId: HOST,
          hostShadowBanned: banned,
          viewerReported: false,
          membership: null,
          effectiveStatus: status,
        }),
      ).toEqual({
        visible: true,
        isHost: true,
        access: 'host',
        canSeeExactPlace: true,
        canSeeMembers: true,
        canManage: status === 'open',
      });
    },
  );

  it('an approved member loses the exact place once the lobby is finished or cancelled', () => {
    const access = (effectiveStatus: LobbyStatus, status: MembershipStatus = 'approved') =>
      resolveLobbyAccess({
        viewerId: VIEWER,
        hostId: HOST,
        hostShadowBanned: false,
        viewerReported: false,
        membership: { status, decidedAt: DECIDED },
        effectiveStatus,
      }).canSeeExactPlace;
    expect(access('open')).toBe(true);
    expect(access('active')).toBe(true);
    expect(access('finished')).toBe(false);
    expect(access('cancelled')).toBe(false);
    expect(access('active', 'attended')).toBe(false);
  });
});
