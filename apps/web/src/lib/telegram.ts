import {
  expandViewport,
  init,
  isTMA,
  miniAppReady,
  mockTelegramEnv,
  mountMiniAppSync,
  retrieveRawInitData,
  setMiniAppBackgroundColor,
  setMiniAppHeaderColor,
} from '@telegram-apps/sdk';

export interface TelegramContext {
  /** Raw initData for backend login; undefined when opened outside Telegram without dev-signed data. */
  rawInitData: string | undefined;
  inTelegram: boolean;
}

/** App background matches the design's dark theme. */
const APP_BACKGROUND = '#000000';

/**
 * Whether a real Telegram client is there to receive events: mobile
 * and desktop clients expose TelegramWebviewProxy, web clients open the Mini App
 * in an iframe. isTMA() alone isn't enough: the SDK keeps launch params in sessionStorage,
 * so after a reload in a regular browser isTMA() still returns true.
 */
function hasTelegramHost(): boolean {
  return 'TelegramWebviewProxy' in window || window.self !== window.top;
}

/**
 * For development in a regular browser: VITE_DEV_INIT_DATA is initData signed
 * with the local BOT_TOKEN (`pnpm --filter @masl/api dev:init-data`). The backend
 * really verifies the signature, so an arbitrary string won't work.
 */
function mockOutsideTelegram(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  const devInitData = import.meta.env.VITE_DEV_INIT_DATA as string | undefined;
  if (!devInitData) {
    return false;
  }
  mockTelegramEnv({
    launchParams: {
      tgWebAppData: devInitData,
      tgWebAppPlatform: 'tdesktop',
      tgWebAppVersion: '8.0',
      tgWebAppThemeParams: {
        bg_color: APP_BACKGROUND,
        text_color: '#F9F9F9',
        hint_color: '#A7A7A7',
        button_color: '#E85002',
        button_text_color: '#F9F9F9',
      },
    },
  });
  return true;
}

export function initTelegram(): TelegramContext {
  const inTelegram = hasTelegramHost() && isTMA();
  if (!inTelegram && !mockOutsideTelegram()) {
    return { rawInitData: undefined, inTelegram: false };
  }

  init();
  miniAppReady.ifAvailable();
  expandViewport.ifAvailable();
  // Header and background colors can only be set once the miniApp component is mounted.
  mountMiniAppSync.ifAvailable();
  setMiniAppHeaderColor.ifAvailable(APP_BACKGROUND);
  setMiniAppBackgroundColor.ifAvailable(APP_BACKGROUND);

  return { rawInitData: retrieveRawInitData(), inTelegram };
}
