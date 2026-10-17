import { createHmac } from 'node:crypto';

export interface FakeTelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  allows_write_to_pm?: boolean;
  photo_url?: string;
  is_bot?: boolean;
}

/**
 * Signs arbitrary initData fields the way Telegram does (independently of the library):
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function signFields(botToken: string, fields: Record<string, string>): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

/** initData with a user, as Telegram.WebApp.initData provides it. */
export function signInitData(
  botToken: string,
  user: FakeTelegramUser,
  options: { authDate?: Date; withSignature?: boolean } = {},
): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor((options.authDate ?? new Date()).getTime() / 1000)),
    query_id: 'AAH-test-query',
    user: JSON.stringify(user),
  };
  if (options.withSignature ?? true) {
    fields.signature = 'test-signature';
  }
  return signFields(botToken, fields);
}
