import { FEEDBACK_RATINGS, type FeedbackRating } from '@masl/shared';

/** Data of the bot's inline buttons; Telegram allows up to 64 bytes. */
export type BotCallback =
  /** Quorum check: lower the karma threshold one preset step. */
  | { action: 'quorum_lower'; lobbyId: string }
  /** Quorum check: ask to confirm the cancel. */
  | { action: 'quorum_cancel'; lobbyId: string }
  /** Quorum check: cancel for good. */
  | { action: 'quorum_cancel_confirm'; lobbyId: string }
  /** Quorum check: keep the meetup as it is. */
  | { action: 'quorum_keep'; lobbyId: string }
  /** Attendance poll: toggle «не было» of one member (application id). */
  | { action: 'attendance_toggle'; memberId: string }
  /** Attendance poll: save. */
  | { action: 'attendance_save'; lobbyId: string }
  | { action: 'feedback'; lobbyId: string; rating: FeedbackRating };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LOBBY_ACTIONS = {
  'q:lower': 'quorum_lower',
  'q:cancel': 'quorum_cancel',
  'q:cancel!': 'quorum_cancel_confirm',
  'q:keep': 'quorum_keep',
  'a:s': 'attendance_save',
} as const;

type LobbyAction = (typeof LOBBY_ACTIONS)[keyof typeof LOBBY_ACTIONS];

const LOBBY_PREFIXES = Object.fromEntries(
  Object.entries(LOBBY_ACTIONS).map(([prefix, action]) => [action, prefix]),
) as Record<LobbyAction, string>;

export function encodeCallback(callback: BotCallback): string {
  switch (callback.action) {
    case 'attendance_toggle':
      return `a:t:${callback.memberId}`;
    case 'feedback':
      return `f:${callback.rating}:${callback.lobbyId}`;
    default:
      return `${LOBBY_PREFIXES[callback.action]}:${callback.lobbyId}`;
  }
}

/** The callback, or null for data this bot never sends (old or forged buttons). */
export function decodeCallback(data: string): BotCallback | null {
  const cut = data.lastIndexOf(':');
  if (cut < 0) return null;
  const prefix = data.slice(0, cut);
  const id = data.slice(cut + 1);
  if (!UUID.test(id)) return null;
  if (prefix === 'a:t') return { action: 'attendance_toggle', memberId: id };
  if (prefix.startsWith('f:')) {
    const rating = prefix.slice(2);
    return (FEEDBACK_RATINGS as readonly string[]).includes(rating)
      ? { action: 'feedback', lobbyId: id, rating: rating as FeedbackRating }
      : null;
  }
  const action = (LOBBY_ACTIONS as Record<string, LobbyAction>)[prefix];
  return action ? { action, lobbyId: id } : null;
}
