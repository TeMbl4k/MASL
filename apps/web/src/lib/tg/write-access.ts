import { requestWriteAccess } from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';

let asked = false;

/**
 * Asks Telegram to let the bot write to the user privately (exact address, answers, the meetup
 * chat). Once per session unless `again` (a tap on the hint); true when the bot may write.
 */
export async function askWriteAccess(again = false): Promise<boolean> {
  if (session.state.status !== 'ready') return false;
  if (session.state.user.botCanWrite) return true;
  if (!session.inTelegram || (asked && !again) || !requestWriteAccess.isAvailable()) return false;
  asked = true;
  try {
    if ((await requestWriteAccess()) !== 'allowed') return false;
  } catch {
    return false;
  }
  // The bot learns it from Telegram too; the app shows it at once.
  if (session.state.status === 'ready') session.setUser({ ...session.state.user, botCanWrite: true });
  return true;
}
