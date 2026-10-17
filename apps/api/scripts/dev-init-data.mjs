// Prints initData signed with the local BOT_TOKEN so the Mini App can be opened in a regular browser.
// Usage: pnpm --filter @masl/api dev:init-data [telegramId] [name]
import { createHmac } from 'node:crypto';

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error('BOT_TOKEN не задан (apps/api/.env)');
  process.exit(1);
}

const [id = '100000001', firstName = 'Тестер'] = process.argv.slice(2);
const fields = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'dev-query',
  // Real Telegram also sends signature (Ed25519); the frontend SDK fails to parse initData without it.
  signature: 'dev-signature',
  user: JSON.stringify({
    id: Number(id),
    first_name: firstName,
    language_code: 'ru',
    allows_write_to_pm: true,
  }),
};
const dataCheckString = Object.keys(fields)
  .sort()
  .map((key) => `${key}=${fields[key]}`)
  .join('\n');
const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
console.log(new URLSearchParams({ ...fields, hash }).toString());
