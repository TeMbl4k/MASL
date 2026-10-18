import { ApiError, ResponseShapeError } from './api.js';

export const OFFLINE_MESSAGE = 'Нет соединения. Проверьте интернет и попробуйте ещё раз.';
export const SERVER_DOWN_MESSAGE = 'Сервер недоступен. Попробуйте чуть позже.';
const UNKNOWN_MESSAGE = 'Что-то пошло не так. Попробуйте ещё раз.';

/**
 * How to show a failed call: the API's own Russian message, a network message, or
 * `update` when the response no longer matches the app (a reload is needed).
 */
export function describeError(error: unknown): { kind: 'update' } | { kind: 'message'; text: string } {
  if (error instanceof ResponseShapeError) return { kind: 'update' };
  if (error instanceof ApiError) {
    return { kind: 'message', text: error.status >= 502 ? SERVER_DOWN_MESSAGE : error.message };
  }
  // fetch throws TypeError when the network or the server is unreachable.
  if (error instanceof TypeError) return { kind: 'message', text: OFFLINE_MESSAGE };
  return { kind: 'message', text: UNKNOWN_MESSAGE };
}

/** An aborted request (a newer one replaced it): not an error to show. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
