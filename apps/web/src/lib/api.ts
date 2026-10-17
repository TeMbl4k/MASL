import type { AuthResponse, InterestDto, MeDto, OnboardingInput } from '@masl/shared';

/**
 * API base URL. Defaults to `/api` on the same origin: in production the API serves
 * the Mini App itself, in development Vite proxies /api to localhost:3000. VITE_API_URL
 * is only needed when the API lives on another domain.
 */
const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.token) {
    headers.set('Authorization', `Bearer ${init.token}`);
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // body isn't JSON, keep the generic message
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  loginWithTelegram: (initData: string) =>
    request<AuthResponse>('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) }),
  me: (token: string) => request<MeDto>('/me', { token }),
  interests: () => request<InterestDto[]>('/interests'),
  completeOnboarding: (token: string, input: OnboardingInput) =>
    request<MeDto>('/me/onboarding', { method: 'PUT', token, body: JSON.stringify(input) }),
};
