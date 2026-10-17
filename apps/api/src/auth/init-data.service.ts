import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { validate } from '@telegram-apps/init-data-node';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';

/**
 * The user field of initData (snake_case JSON, as Telegram sends it).
 * Parsed by hand: the library's parse() requires the signature field, which
 * may be missing, and does not camelCase the nested object's keys.
 */
const initDataUser = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  language_code: z.string().optional(),
  allows_write_to_pm: z.boolean().optional(),
  is_bot: z.boolean().optional(),
});

/** Telegram user confirmed by the initData signature. */
export interface TelegramIdentity {
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  allowsWriteToPm: boolean;
  /** When Telegram issued this initData (auth_date). */
  authDate: Date;
}

/**
 * Verifies the initData the Mini App receives from Telegram:
 * HMAC signature with the bot token and auth_date freshness.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
@Injectable()
export class InitDataService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  verify(rawInitData: string): TelegramIdentity {
    try {
      validate(rawInitData, this.env.BOT_TOKEN, { expiresIn: this.env.INIT_DATA_MAX_AGE_SECONDS });
    } catch {
      // Don't tell the client what exactly failed: signature, expiry or format.
      throw new UnauthorizedException('initData не прошла проверку');
    }

    // validate() has already checked that auth_date is present and initData is fresh.
    const params = new URLSearchParams(rawInitData);
    const authDate = new Date(Number(params.get('auth_date')) * 1000);

    let rawUser: unknown;
    try {
      const userJson = params.get('user');
      rawUser = userJson === null ? undefined : JSON.parse(userJson);
    } catch {
      throw new UnauthorizedException('initData не прошла проверку');
    }
    const parsedUser = initDataUser.safeParse(rawUser);
    if (!parsedUser.success || parsedUser.data.is_bot) {
      throw new UnauthorizedException('В initData нет пользователя');
    }
    const user = parsedUser.data;

    return {
      telegramId: user.id,
      firstName: user.first_name,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
      photoUrl: user.photo_url ?? null,
      languageCode: user.language_code ?? null,
      allowsWriteToPm: user.allows_write_to_pm ?? false,
      authDate,
    };
  }
}
