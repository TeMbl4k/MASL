# MASL

Telegram Mini App для спонтанных встреч в Москве: лобби-события (спорт, настолки, бары, нетворкинг), карма вместо залогов, общение через Telegram-бота.

## Состав

| Путь              | Что внутри                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `apps/web`        | Mini App: SvelteKit 3 (SPA, adapter-static), Svelte 5, Tailwind 4, Telegram SDK |
| `apps/api`        | API: NestJS 12 на Fastify, вход по initData, сессии JWT                         |
| `packages/db`     | Схема Drizzle ORM, миграции, PostGIS (`geography(Point, 4326)`)                 |
| `packages/shared` | Общие zod-схемы, перечисления и продуктовые константы (карма, лимиты)           |

## Быстрый старт

Нужны Node.js 22.17+, pnpm 10 (`corepack enable`) и Docker.

```bash
pnpm install
pnpm db:up                                   # PostgreSQL + PostGIS и Redis в Docker
cp apps/api/.env.example apps/api/.env        # заполните BOT_TOKEN и JWT_SECRET
cp apps/web/.env.example apps/web/.env
pnpm build                                   # собрать общие пакеты
pnpm db:migrate                              # DATABASE_URL берётся из apps/api/.env
pnpm dev                                     # API на :3000, Mini App на :5173
```

С заглушками секретов из `.env.example` API не стартует. Справочник интересов API заливает в базу сам при старте. В разработке Mini App ходит в API через `/api`: Vite проксирует его на `localhost:3000`.

### Открыть Mini App в обычном браузере

API по-настоящему проверяет подпись initData, поэтому для браузера нужна initData, подписанная вашим `BOT_TOKEN`:

```bash
pnpm --filter @masl/api dev:init-data 100000001 Тестер
```

Вставьте результат в `VITE_DEV_INIT_DATA` в `apps/web/.env` и перезапустите `pnpm dev`. initData живёт сутки (`INIT_DATA_MAX_AGE_SECONDS`).

### Открыть в Telegram

Mini App должна открываться по HTTPS. Поднимите туннель `cloudflared tunnel --url http://localhost:5173` и укажите его адрес в @BotFather (Bot Settings → Configure Mini App). API идёт через тот же туннель по `/api`, второй туннель и `WEB_ORIGINS` не нужны. Vite пускает только хосты `*.trycloudflare.com`: для другого туннеля добавьте его в `server.allowedHosts` в `apps/web/vite.config.ts`.

### Деплой

Для сборки Mini App обязателен `VITE_API_URL` (адрес API). API в production (`NODE_ENV=production`) требует `WEB_ORIGINS`: адрес, с которого открывается Mini App, без пути.

## Проверки

```bash
pnpm format:check
pnpm typecheck
pnpm lint
TEST_DATABASE_URL=postgres://masl:masl@localhost:5432/masl pnpm test
```

Тесты базы и e2e API создают отдельную временную базу на сервере из `TEST_DATABASE_URL` и удаляют её после себя. Без этой переменной они пропускаются. В CI (GitHub Actions) PostGIS поднимается сервисом.

## Миграции

```bash
pnpm db:generate   # после изменения packages/db/src/schema.ts
```

drizzle-kit берёт пользовательский тип в кавычки: после генерации замените `"geography(Point, 4326)"` на `geography(Point, 4326)` в новом SQL-файле. Тест `geo.integration.test.ts` упадёт, если забыть.

## API

| Метод | Путь             | Что делает                                                    |
| ----- | ---------------- | ------------------------------------------------------------- |
| POST  | `/auth/telegram` | `{ initData }` → проверка подписи, создание пользователя, JWT |
| GET   | `/me`            | Профиль текущего пользователя (Bearer)                        |
| PUT   | `/me/onboarding` | Пол, возраст, 3–5 интересов (Bearer)                          |
| GET   | `/interests`     | Облако интересов                                              |
| GET   | `/health`        | Проверка API и базы                                           |
