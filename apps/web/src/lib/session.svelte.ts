import type { InterestDto, MeDto, OnboardingInput } from '@masl/shared';
import { api, ApiError } from './api.js';
import { initTelegram, type TelegramContext } from './telegram.js';

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
    // fetch throws TypeError when the network or server is unreachable.
    return 'Сервер недоступен. Попробуйте ещё раз чуть позже.';
  }
  return 'Не получилось запустить приложение. Откройте его заново.';
}

/** Mini App session state: initData login, current user and the interests list. */
class Session {
  state = $state<SessionState>({ status: 'loading' });
  interests = $state<InterestDto[]>([]);

  #telegram: TelegramContext | undefined;

  /** Opened by a real Telegram client (not the dev mock): native buttons and popups exist. */
  get inTelegram(): boolean {
    return this.#telegram?.inTelegram ?? false;
  }

  async start(): Promise<void> {
    this.state = { status: 'loading' };
    try {
      // Init the SDK once; the Retry button only calls the API again.
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
   * Calls the API with the session token. On 401 (expired session) logs in once more
   * with the same initData and retries the call; if that fails too, shows an error.
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
