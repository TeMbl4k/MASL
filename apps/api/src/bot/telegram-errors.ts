import { GrammyError, HttpError } from 'grammy';

/**
 * How a failed Bot API call should be handled. Only the method and the numeric code are ever
 * logged: Telegram descriptions and payloads can carry message texts, names and addresses.
 */
export type TelegramFailure =
  /** 429: wait `retryAfterSeconds`, then try again. */
  | { kind: 'rate_limited'; code: 429; retryAfterSeconds: number }
  /** 5xx, network or anything unknown: try again later. */
  | { kind: 'transient'; code: number | null }
  /** 4xx: retrying won't help. 403 means the user blocked the bot or never started it. */
  | { kind: 'permanent'; code: number };

export function classifyTelegramError(error: unknown): TelegramFailure {
  if (error instanceof GrammyError) {
    if (error.error_code === 429) {
      return { kind: 'rate_limited', code: 429, retryAfterSeconds: error.parameters.retry_after ?? 5 };
    }
    if (error.error_code >= 500) return { kind: 'transient', code: error.error_code };
    return { kind: 'permanent', code: error.error_code };
  }
  return { kind: 'transient', code: null };
}

/** One log fragment for a failed call: «sendMessage 403», «getUpdates сеть». */
export function describeTelegramError(error: unknown): string {
  if (error instanceof GrammyError) return `${error.method} ${error.error_code}`;
  if (error instanceof HttpError) return 'сеть';
  return error instanceof Error ? error.constructor.name : typeof error;
}
