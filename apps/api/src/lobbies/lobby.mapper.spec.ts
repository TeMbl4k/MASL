import {
  APPLICATIONS_PENDING_MAX,
  APPLICATIONS_PER_DAY_MAX,
  APPLY_BLOCK_REASONS,
  applicantDto,
  lobbyCardDto,
  lobbyDetailDto,
} from '@masl/shared';
import { placeHint, stationById } from '@masl/shared/metro';
import type { ApplicantRow, LobbyCardRow, ViewerContext } from './lobby-queries.js';
import {
  applyBlock,
  parseCancelReason,
  toApplicant,
  toLobbyCard,
  toLobbyDetail,
  toPublicPlace,
  type ApplyBlockInput,
} from './lobby.mapper.js';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const HOUR = 3600_000;

const viewer = (patch: Partial<ViewerContext> = {}): ViewerContext => ({
  userId: 'viewer',
  karma: 50,
  onboarded: true,
  lobbyCreationBlocked: false,
  interests: ['sport'],
  pendingApplications: 0,
  applicationsInWindow: 0,
  ...patch,
});

const lobby = (patch: Partial<ApplyBlockInput> = {}): ApplyBlockInput => ({
  isHost: false,
  effectiveStatus: 'open',
  membership: null,
  minKarma: null,
  slots: 3,
  approvedCount: 0,
  ...patch,
});

const DECIDED = new Date(NOW.getTime() - HOUR);

describe('applyBlock', () => {
  it('passes a viewer who meets every rule', () => {
    expect(applyBlock(viewer(), lobby())).toBeNull();
  });

  it('reports every reason, each one winning over all the later ones', () => {
    // Each step breaks one more rule than the next, so the earliest broken rule must win.
    const steps: [Partial<ViewerContext>, Partial<ApplyBlockInput>][] = [
      [{ onboarded: false }, {}],
      [{}, { isHost: true }],
      [{}, { effectiveStatus: 'active' }],
      [{}, { membership: { status: 'rejected', decidedAt: DECIDED } }],
      [{}, { membership: { status: 'cancelled', decidedAt: DECIDED } }],
      [{}, { minKarma: 51 }],
      [{}, { approvedCount: 3 }],
      [{ pendingApplications: APPLICATIONS_PENDING_MAX }, {}],
      [{ applicationsInWindow: APPLICATIONS_PER_DAY_MAX }, {}],
    ];
    expect(steps).toHaveLength(APPLY_BLOCK_REASONS.length);
    APPLY_BLOCK_REASONS.forEach((reason, i) => {
      const v = Object.assign({}, ...steps.slice(i).map(([p]) => p)) as Partial<ViewerContext>;
      // A rejected and a left membership can't both hold; from the 'left' step on, keep 'left'.
      const l = Object.assign({}, ...steps.slice(i).map(([, p]) => p)) as Partial<ApplyBlockInput>;
      if (i <= 3) l.membership = { status: 'rejected', decidedAt: DECIDED };
      expect(applyBlock(viewer(v), lobby(l)), reason).toBe(reason);
    });
  });

  it('not_open covers cancelled, active and finished', () => {
    for (const effectiveStatus of ['cancelled', 'active', 'finished'] as const) {
      expect(applyBlock(viewer(), lobby({ effectiveStatus }))).toBe('not_open');
    }
  });

  it('is null for a pending or approved viewer on an open lobby, even when full or locked', () => {
    for (const status of ['pending', 'approved'] as const) {
      const membership = { status, decidedAt: status === 'approved' ? DECIDED : null };
      expect(
        applyBlock(
          viewer({ karma: 10, pendingApplications: 99 }),
          lobby({ membership, minKarma: 60, approvedCount: 3 }),
        ),
      ).toBeNull();
      expect(applyBlock(viewer(), lobby({ membership, effectiveStatus: 'active' }))).toBe('not_open');
    }
  });

  it('min karma is inclusive; a withdrawn application may apply again', () => {
    expect(applyBlock(viewer({ karma: 50 }), lobby({ minKarma: 50 }))).toBeNull();
    expect(applyBlock(viewer({ karma: 49 }), lobby({ minKarma: 50 }))).toBe('karma');
    expect(applyBlock(viewer(), lobby({ membership: { status: 'cancelled', decidedAt: null } }))).toBeNull();
  });
});

describe('places and cancel reasons', () => {
  it('builds the public place from the row snapshot and the current line data', () => {
    const { station, line } = stationById('2-dinamo')!;
    expect(
      toPublicPlace({
        placeHint: placeHint(station, line),
        metroStationId: station.id,
        publicLocation: { lat: station.lat, lng: station.lng },
        farFromMetro: false,
      }),
    ).toEqual({
      hint: 'м. Динамо',
      stationId: '2-dinamo',
      lineName: line.name,
      lineColor: line.color,
      point: { lat: station.lat, lng: station.lng },
      farFromMetro: false,
    });
    const mcc = stationById('14-luzhniki')!;
    expect(placeHint(mcc.station, mcc.line)).toBe('МЦК Лужники');
  });

  it('keeps the snapshot of a station that left the dataset, with null line data', () => {
    expect(
      toPublicPlace({
        placeHint: 'м. Старая',
        metroStationId: '99-gone',
        publicLocation: { lat: 55.7, lng: 37.6 },
        farFromMetro: true,
      }),
    ).toEqual({
      hint: 'м. Старая',
      stationId: '99-gone',
      lineName: null,
      lineColor: null,
      point: { lat: 55.7, lng: 37.6 },
      farFromMetro: true,
    });
  });

  it('reads an unknown stored cancel reason as other', () => {
    expect(parseCancelReason(null)).toBeNull();
    expect(parseCancelReason('plans_changed')).toBe('plans_changed');
    expect(parseCancelReason('garbage')).toBe('other');
  });
});

describe('cards and details', () => {
  const row = (patch: Partial<LobbyCardRow> = {}): LobbyCardRow => ({
    id: '6f1c3a52-6a51-4a39-9c51-2b9f7a3c1d10',
    hostId: 'host',
    category: 'sport',
    title: 'Падел',
    description: null,
    startsAt: new Date(NOW.getTime() + 3 * HOUR),
    endsAt: new Date(NOW.getTime() + 5 * HOUR),
    status: 'open',
    slots: 3,
    minKarma: null,
    paymentFormat: 'free',
    placeHint: 'м. Динамо',
    metroStationId: '2-dinamo',
    publicLocation: { lat: 55.7897125, lng: 37.5581576 },
    farFromMetro: false,
    cancelReason: null,
    cancelComment: null,
    hostFirstName: 'Анна',
    hostPhotoUrl: null,
    hostKarma: 50,
    hostShadowBanned: false,
    approvedCount: 1,
    pendingCount: 2,
    memberStatus: null,
    memberDecidedAt: null,
    viewerReported: false,
    distanceM: 1249.7,
    ...patch,
  });

  it('shows the effective status, the rounded distance and pendingCount only to the host', () => {
    const card = toLobbyCard(row({ startsAt: new Date(NOW.getTime() - HOUR) }), viewer(), NOW);
    expect(lobbyCardDto.parse(card)).toEqual(card);
    expect(card).toMatchObject({ status: 'active', distanceM: 1200, pendingCount: null });
    expect(card.viewer).toEqual({
      isHost: false,
      membershipStatus: null,
      applyBlock: 'not_open',
      reported: false,
    });

    const hostCard = toLobbyCard(row(), viewer({ userId: 'host' }), NOW);
    expect(hostCard).toMatchObject({ pendingCount: 2, viewer: { isHost: true, applyBlock: 'own' } });
    expect(toLobbyCard(row({ distanceM: null }), viewer(), NOW).distanceM).toBeNull();
  });

  it('a public detail has no exact place, a member detail has it', () => {
    const publicDetail = toLobbyDetail(row(), viewer(), NOW, { access: 'public' }, null);
    expect(lobbyDetailDto.parse(publicDetail)).toEqual(publicDetail);
    expect(publicDetail).not.toHaveProperty('exactPlace');

    const exactPlace = { address: 'ул. Тестовая, 1', point: { lat: 55.78, lng: 37.55 } };
    const memberDetail = toLobbyDetail(row(), viewer(), NOW, { access: 'member', exactPlace }, []);
    expect(lobbyDetailDto.parse(memberDetail)).toMatchObject({ access: 'member', exactPlace, members: [] });
  });
});

describe('applicants', () => {
  const row = (patch: Partial<ApplicantRow> = {}): ApplicantRow => ({
    id: '00000000-0000-4000-8000-000000000009',
    status: 'pending',
    appliedAt: NOW,
    decidedAt: null,
    firstName: 'Борис',
    photoUrl: null,
    karma: 50,
    attended: 0,
    ...patch,
  });

  it('shows the public person data, the newbie flag and the threshold check only', () => {
    const dto = toApplicant(row(), 50);
    expect(applicantDto.parse(dto)).toEqual({
      applicationId: '00000000-0000-4000-8000-000000000009',
      status: 'pending',
      appliedAt: NOW.toISOString(),
      decidedAt: null,
      user: { firstName: 'Борис', photoUrl: null, karma: 50, isNewbie: true },
      meetsMinKarma: true,
    });
  });

  it('is not a newbie after an attended meetup; the karma threshold is inclusive', () => {
    expect(toApplicant(row({ attended: 1 }), null).user.isNewbie).toBe(false);
    expect(toApplicant(row({ karma: 49 }), 50).meetsMinKarma).toBe(false);
    expect(toApplicant(row({ karma: 0 }), null).meetsMinKarma).toBe(true);
    expect(toApplicant(row({ status: 'approved', decidedAt: NOW }), null).decidedAt).toBe(NOW.toISOString());
  });
});
