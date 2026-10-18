import { on, postEvent } from '@telegram-apps/bridge';
import { retrieveLaunchParams } from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';

/**
 * WebApp.requestChat (Bot API 9.6) isn't in the SDK yet, so its raw events are used:
 * `web_app_request_chat` with the prepared button id, then `requested_chat_sent` or
 * `requested_chat_failed` (https://core.telegram.org/api/web-events).
 */
const MIN_VERSION = [9, 6] as const;
const post = postEvent as unknown as (method: string, params: { req_id: string }) => void;
const listen = on as unknown as (event: string, listener: () => void) => VoidFunction;

/** Whether `version` ("9.6", "10.1") is at least `min`. */
export function versionAtLeast(version: string, min: readonly number[]): boolean {
  const parts = version.split('.').map(Number);
  for (const [index, wanted] of min.entries()) {
    const part = parts[index] ?? 0;
    if (Number.isNaN(part)) return false;
    if (part !== wanted) return part > wanted;
  }
  return true;
}

/** Whether this Telegram client can open the group picker right in the app. */
export function canRequestChat(): boolean {
  if (!session.inTelegram) return false;
  try {
    return versionAtLeast(retrieveLaunchParams().tgWebAppVersion, MIN_VERSION);
  } catch {
    return false;
  }
}

/**
 * Opens Telegram's picker for a group (an existing one or a new one) with a prepared button.
 * Resolves true once the choice reached the bot, false when it was cancelled or failed.
 */
export function requestChat(preparedButtonId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stops = [
      listen('requested_chat_sent', () => done(true)),
      listen('requested_chat_failed', () => done(false)),
    ];
    function done(sent: boolean) {
      for (const stop of stops) stop();
      resolve(sent);
    }
    try {
      post('web_app_request_chat', { req_id: preparedButtonId });
    } catch {
      done(false);
    }
  });
}
