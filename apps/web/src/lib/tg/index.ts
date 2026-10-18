import {
  bindViewportCssVars,
  isViewportCssVarsBound,
  mountBackButton,
  mountClosingBehavior,
  mountMainButton,
  mountSwipeBehavior,
  mountViewport,
  setMainButtonParams,
  setMiniAppBottomBarColor,
} from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';
import { TG_BRAND, TG_INK, TG_PAPER } from './colors.js';

const VIEWPORT_MOUNT_TIMEOUT_MS = 3000;

let mounted = false;

/**
 * Mounts the native controls once the session is ready. Outside a real Telegram client
 * (including the dev mock, which has no host to answer) the in-page fallbacks are used.
 */
export async function mountTelegramUi(): Promise<void> {
  if (mounted || !session.inTelegram) return;
  mounted = true;

  mountBackButton.ifAvailable();
  mountMainButton.ifAvailable();
  mountClosingBehavior.ifAvailable();
  mountSwipeBehavior.ifAvailable();
  setMiniAppBottomBarColor.ifAvailable(TG_INK);
  setMainButtonParams.ifAvailable({ isVisible: false, backgroundColor: TG_BRAND, textColor: TG_PAPER });

  // Full-height screens use --tg-viewport-stable-height when it is bound, 100dvh otherwise.
  try {
    const [called, promise] = mountViewport.ifAvailable({ timeout: VIEWPORT_MOUNT_TIMEOUT_MS });
    if (called) await promise;
    if (!isViewportCssVarsBound()) bindViewportCssVars.ifAvailable();
  } catch {
    // The client didn't answer in time: the CSS falls back to the browser viewport.
  }
}
