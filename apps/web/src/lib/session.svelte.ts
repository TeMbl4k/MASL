import type { InterestDto, MeDto, OnboardingInput } from '@masl/shared';
import { api, ApiError } from './api.js';
import { initTelegram } from './telegram.js';

type SessionState =
  | { status: 'loading' }
  | { status: 'outside-telegram' }
  | { status: 'error'; message: string }
  | { status: 'ready'; token: string; user: MeDto };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 401
      ? 'Не удалось подтвердить вход через Telegram. Откройте приложение заново.'
      : 'Сервер недоступен. Попробуйте ещё раз чуть позже.';
  }
  if (error instanceof TypeError) {
    // fetch бросает TypeError, когда сети или сервера нет.
    return 'Сервер недоступен. Попробуйте ещё раз чуть позже.';
  }
  return 'Не получилось запустить приложение. Откройте его заново.';
}

/** Состояние сессии Mini App: вход по initData, текущий пользователь и справочник интересов. */
class Session {
  state = $state<SessionState>({ status: 'loading' });
  interests = $state<InterestDto[]>([]);

  #telegram: { rawInitData: string | undefined } | undefined;

  async start(): Promise<void> {
    this.state = { status: 'loading' };
    try {
      // SDK инициализируем один раз; «Повторить» только заново ходит в API.
      this.#telegram ??= initTelegram();
      const { rawInitData } = this.#telegram;
      if (!rawInitData) {
        this.state = { status: 'outside-telegram' };
        return;
      }
      const [{ token, user }, interests] = await Promise.all([
        api.loginWithTelegram(rawInitData),
        api.interests(),
      ]);
      this.interests = interests;
      this.state = { status: 'ready', token, user };
    } catch (error) {
      this.state = { status: 'error', message: errorMessage(error) };
    }
  }

  async completeOnboarding(input: OnboardingInput): Promise<void> {
    const user = await this.#withToken((token) => api.completeOnboarding(token, input));
    if (this.state.status === 'ready') {
      this.state = { ...this.state, user };
    }
  }

  /**
   * Запрос с токеном сессии. Если сессия истекла (401), один раз входит заново
   * по той же initData и повторяет запрос; если и это не вышло, показывает ошибку.
   */
  async #withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    if (this.state.status !== 'ready') {
      throw new Error('Сессия ещё не готова');
    }
    try {
      return await call(this.state.token);
    } catch (error) {
      const rawInitData = this.#telegram?.rawInitData;
      if (!(error instanceof ApiError) || error.status !== 401 || !rawInitData) {
        throw error;
      }
      let fresh;
      try {
        fresh = await api.loginWithTelegram(rawInitData);
      } catch (loginError) {
        this.state = { status: 'error', message: errorMessage(loginError) };
        throw loginError;
      }
      this.state = { status: 'ready', token: fresh.token, user: fresh.user };
      return call(fresh.token);
    }
  }
}

export const session = new Session();
