import { showPopup } from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';
import { haptic } from './haptics.js';

export interface ConfirmOptions {
  /** Up to 64 characters. */
  title: string;
  /** Up to 256 characters. */
  message: string;
  confirmText: string;
  /** Red confirm button for actions that can't be undone. */
  destructive?: boolean;
}

// Telegram rejects longer popup texts.
const TITLE_MAX = 64;
const MESSAGE_MAX = 256;
const BUTTON_MAX = 64;

/** Native confirmation popup; resolves true only when the confirm button was pressed. */
export async function confirm({
  title,
  message,
  confirmText,
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (destructive) haptic.warning();
  // The dev mock reports the popup as supported, but no host answers it.
  if (!session.inTelegram || !showPopup.isAvailable()) {
    return window.confirm(`${title}\n\n${message}`);
  }
  try {
    const pressed = await showPopup({
      title: title.slice(0, TITLE_MAX),
      message: message.slice(0, MESSAGE_MAX),
      buttons: [
        { id: 'cancel', type: 'cancel' },
        {
          id: 'confirm',
          type: destructive ? 'destructive' : 'default',
          text: confirmText.slice(0, BUTTON_MAX),
        },
      ],
    });
    return pressed === 'confirm';
  } catch {
    // Another popup is open, or the client refused: treat as not confirmed.
    return false;
  }
}
