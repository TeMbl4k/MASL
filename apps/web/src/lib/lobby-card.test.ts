import {
  lobbyCardDto,
  lobbyDetailDto,
  type LobbyCardDto,
  type LobbyDetailDto,
  type LobbyViewerDto,
} from '@masl/shared';
import { describe, expect, it } from 'vitest';
import { cardOf, detailMatchesCard, minKarmaMet } from './lobby-card.js';

const detail: LobbyDetailDto = lobbyDetailDto.parse({
  id: crypto.randomUUID(),
  category: 'sport',
  title: 'Падел 2×2',
  startsAt: '2026-10-17T16:30:00.000Z',
  endsAt: '2026-10-17T18:30:00.000Z',
  status: 'open',
  slots: 3,
  approvedCount: 1,
  pendingCount: null,
  minKarma: 40,
  paymentFormat: 'split',
  place: {
    hint: 'м. Динамо',
    stationId: '2-dinamo',
    lineName: 'Замоскворецкая',
    lineColor: '#44b85c',
    point: { lat: 55.7897, lng: 37.5582 },
    farFromMetro: false,
  },
  distanceM: 2400,
  host: { code: 'a1b2c3d4e5f6', firstName: 'Анна', photoUrl: null, karma: 50 },
  viewer: { isHost: false, membershipStatus: 'approved', applyBlock: null, reported: false },
  description: 'Корт забронирован',
  cancelReason: null,
  cancelComment: null,
  members: [{ code: 'b1b2c3d4e5f6', firstName: 'Борис', photoUrl: null, karma: 50 }],
  chat: null,
  cancelPolicy: null,
  checkIn: null,
  attendance: null,
  canInvite: true,
  invite: null,
  access: 'member',
  exactPlace: { address: 'Ленинградский проспект, 36', point: { lat: 55.7901, lng: 37.5601 } },
});

describe('cardOf', () => {
  it('keeps only the public card fields of a member detail', () => {
    const card = cardOf(detail);
    // A strict schema: any extra field (exactPlace, members, access) would fail here.
    expect(lobbyCardDto.safeParse(card).success).toBe(true);
    expect(Object.keys(card).sort()).toEqual(Object.keys(lobbyCardDto.shape).sort());
    expect(JSON.stringify(card)).not.toContain('Ленинградский');
    expect(card.place.hint).toBe('м. Динамо');
  });
});

const card = cardOf(detail);
const withViewer = (viewer: Partial<LobbyViewerDto>): LobbyCardDto => ({
  ...card,
  viewer: { ...card.viewer, ...viewer },
});

describe('minKarmaMet', () => {
  it('checks the threshold for someone who could apply', () => {
    const outsider = withViewer({ membershipStatus: null });
    expect(minKarmaMet(outsider, 40)).toBe(true);
    expect(minKarmaMet(outsider, 39)).toBe(false);
    expect(minKarmaMet(outsider, null)).toBe(false);
    expect(minKarmaMet(withViewer({ membershipStatus: 'pending' }), 39)).toBe(false);
    expect(minKarmaMet(withViewer({ membershipStatus: 'rejected' }), 39)).toBe(false);
  });

  it('never locks the host or a member already in the lobby', () => {
    expect(minKarmaMet(withViewer({ isHost: true, membershipStatus: null }), 30)).toBe(true);
    expect(minKarmaMet(withViewer({ membershipStatus: 'approved' }), 30)).toBe(true);
    expect(minKarmaMet(withViewer({ membershipStatus: 'attended' }), null)).toBe(true);
  });

  it('is met when there is no threshold', () => {
    expect(minKarmaMet({ ...withViewer({ membershipStatus: null }), minKarma: null }, 0)).toBe(true);
  });
});

describe('detailMatchesCard', () => {
  it('keeps the detail while the status and the viewer role stay the same', () => {
    expect(detailMatchesCard(detail, card)).toBe(true);
    expect(detailMatchesCard(detail, { ...withViewer({ applyBlock: 'full' }), approvedCount: 3 })).toBe(true);
  });

  it('drops the detail when the card shows that access may be gone', () => {
    expect(detailMatchesCard(detail, withViewer({ membershipStatus: 'cancelled', applyBlock: 'left' }))).toBe(
      false,
    );
    expect(detailMatchesCard(detail, withViewer({ membershipStatus: 'rejected' }))).toBe(false);
    expect(detailMatchesCard(detail, { ...card, status: 'cancelled' })).toBe(false);
    expect(detailMatchesCard(detail, { ...card, status: 'finished' })).toBe(false);
    expect(detailMatchesCard(detail, withViewer({ isHost: true }))).toBe(false);
  });
});
