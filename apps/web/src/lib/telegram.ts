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
  /** Сырая initData для входа на бэкенде; нет, если открыто вне Telegram без dev-подписи. */
  rawInitData: string | undefined;
  inTelegram: boolean;
}

/** Фон приложения совпадает с тёмной темой дизайна. */
const APP_BACKGROUND = '#000000';

/**
 * Есть ли настоящий клиент Telegram, которому можно слать события: мобильные
 * и десктопные клиенты дают TelegramWebviewProxy, веб-версии открывают Mini App
 * в iframe. Одного isTMA() мало: SDK сохраняет параметры запуска в sessionStorage,
 * и после перезагрузки в обычном браузере isTMA() тоже возвращает true.
 */
function hasTelegramHost(): boolean {
  return 'TelegramWebviewProxy' in window || window.self !== window.top;
}

/**
 * Для разработки в обычном браузере: VITE_DEV_INIT_DATA — initData, подписанная
 * локальным BOT_TOKEN (`pnpm --filter @masl/api dev:init-data`). Бэкенд проверяет
 * подпись по-настоящему, поэтому произвольная строка не подойдёт.
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
  // Цвета шапки и фона меняются только у смонтированного компонента miniApp.
  mountMiniAppSync.ifAvailable();
  setMiniAppHeaderColor.ifAvailable(APP_BACKGROUND);
  setMiniAppBackgroundColor.ifAvailable(APP_BACKGROUND);

  return { rawInitData: retrieveRawInitData(), inTelegram };
}
