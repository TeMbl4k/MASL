import {
  lobbyCardDto,
  meetsMinKarma,
  type LobbyCardDto,
  type LobbyDetailDto,
  type MembershipStatus,
  OCCUPYING_MEMBERSHIP_STATUSES,
} from '@masl/shared';

const CARD_KEYS = Object.keys(lobbyCardDto.shape) as (keyof LobbyCardDto)[];

/**
 * The card part of a lobby detail, built field by field from the card schema, so the exact
 * place, the member list and the description never travel into feed or «Мои» state.
 */
export function cardOf(detail: LobbyDetailDto): LobbyCardDto {
  return Object.fromEntries(CARD_KEYS.map((key) => [key, detail[key]])) as LobbyCardDto;
}

function isOccupying(status: MembershipStatus | null): boolean {
  return status !== null && (OCCUPYING_MEMBERSHIP_STATUSES as readonly MembershipStatus[]).includes(status);
}

/**
 * The min-karma badge is met: the threshold only gates applying, so the host and members already
 * in the lobby always meet it, even when their karma is below.
 */
export function minKarmaMet(lobby: Pick<LobbyCardDto, 'minKarma' | 'viewer'>, karma: number | null): boolean {
  if (lobby.viewer.isHost || isOccupying(lobby.viewer.membershipStatus)) return true;
  return karma !== null && meetsMinKarma(karma, lobby.minKarma);
}

/**
 * A cached detail still matches a fresher card: same status and the same viewer role. Otherwise
 * access may have changed (rejected, left, cancelled, finished) and the detail, which may hold the
 * exact place, must go.
 */
export function detailMatchesCard(detail: LobbyDetailDto, card: LobbyCardDto): boolean {
  return (
    detail.status === card.status &&
    detail.viewer.isHost === card.viewer.isHost &&
    detail.viewer.membershipStatus === card.viewer.membershipStatus
  );
}
