import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { validate } from '@telegram-apps/init-data-node';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';

/**
 * Поле user из initData (JSON в snake_case, как его присылает Telegram).
 * Разбираем сами: parse() из библиотеки требует поле signature, которого
 * может не быть, и не меняет регистр ключей вложенного объекта.
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

/** Пользователь Telegram, подтверждённый подписью initData. */
export interface TelegramIdentity {
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  allowsWriteToPm: boolean;
  /** Когда Telegram выдал эту initData (auth_date). */
  authDate: Date;
}

/**
 * Проверяет initData, которую Mini App получает от Telegram:
 * HMAC-подпись токеном бота и свежесть auth_date.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
@Injectable()
export class InitDataService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  verify(rawInitData: string): TelegramIdentity {
    try {
      validate(rawInitData, this.env.BOT_TOKEN, { expiresIn: this.env.INIT_DATA_MAX_AGE_SECONDS });
    } catch {
      // Не раскрываем клиенту, что именно не так: подпись, срок или формат.
      throw new UnauthorizedException('initData не прошла проверку');
    }

    // validate() уже проверил, что auth_date есть и initData свежая.
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
