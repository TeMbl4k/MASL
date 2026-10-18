# MASL

Telegram Mini App для спонтанных встреч в Москве: лобби-события (спорт, настолки, бары, нетворкинг), карма вместо залогов, общение через Telegram-бота.

## Состав

| Путь              | Что внутри                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `apps/web`        | Mini App: SvelteKit 3 (SPA, adapter-static), Svelte 5, Tailwind 4, Telegram SDK |
| `apps/api`        | API: NestJS 12 на Fastify, вход по initData, сессии JWT                         |
| `packages/db`     | Схема Drizzle ORM, миграции, PostGIS (`geography(Point, 4326)`)                 |
| `packages/shared` | Общие zod-схемы, перечисления и продуктовые константы (карма, лимиты)           |

## Правила и память проекта

| Файл                         | Что внутри                                       |
| ---------------------------- | ------------------------------------------------ |
| [CLAUDE.md](CLAUDE.md)       | Правила работы над кодом: что можно и что нельзя |
| [tech.md](tech.md)           | Стек, стадии и что в каждой уже готово           |
| [decisions.md](decisions.md) | Принятые решения и почему                        |
| [bugs.md](bugs.md)           | Известные баги и грабли                          |
| [todo.md](todo.md)           | Задачи: в работе, ждут владельца, дальше         |
| [style.md](style.md)         | Дизайн-система и стиль кода                      |

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

`Dockerfile` в корне собирает один образ: API отдаёт и Mini App, и `/api`, а перед стартом применяет миграции. Нужна PostgreSQL с PostGIS и переменные `DATABASE_URL`, `BOT_TOKEN`, `JWT_SECRET`, `NODE_ENV=production`. Пошагово на своём сервере (база, приложение и HTTPS одной командой): [docs/deploy-vps.md](docs/deploy-vps.md). Другие варианты: бесплатно на Render + Neon ([docs/deploy-render.md](docs/deploy-render.md)) и на Railway ([docs/deploy-railway.md](docs/deploy-railway.md)). Что видят логи и сторонние сервисы: [docs/privacy.md](docs/privacy.md).

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

Все маршруты API живут под `/api`, остальное отдаёт Mini App (один домен, без CORS). Кроме `/api/health`, `/api/auth/telegram` и `/api/interests`, все требуют сессию (`Authorization: Bearer`). Запросы и ответы описаны zod-схемами в `packages/shared/src/schemas.ts`; ошибки — `{ statusCode, code, message }` с русским `message` (у ошибок валидации — `{ message, issues }` без `code`).

| Метод  | Путь                                                   | Что делает                                                                     |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| POST   | `/api/auth/telegram`                                   | `{ initData }` → проверка подписи, создание пользователя, JWT                  |
| GET    | `/api/health`                                          | Проверка API и базы                                                            |
| GET    | `/api/interests`                                       | Облако интересов                                                               |
| GET    | `/api/me`                                              | Профиль текущего пользователя                                                  |
| PUT    | `/api/me/onboarding`                                   | Пол, возраст, 3–5 интересов                                                    |
| PUT    | `/api/me/interests`                                    | Сменить интересы (3–5)                                                         |
| GET    | `/api/me/lobbies`                                      | «Мои события»: организую и участвую, предстоящие и прошедшие, счётчики         |
| GET    | `/api/me/karma-events`                                 | Последние 20 изменений кармы                                                   |
| GET    | `/api/lobbies/feed`                                    | Лента «Для вас»: фильтры категории и дня, точка отсчёта, курсор, счётчики дней |
| GET    | `/api/lobbies/map`                                     | Встречи по станциям метро для карты (до 300)                                   |
| GET    | `/api/lobbies/creation-context`                        | Можно ли создать встречу сейчас (лимиты, когда снова) и есть ли подсказки      |
| POST   | `/api/lobbies`                                         | Создать встречу (идемпотентно по `requestId`)                                  |
| GET    | `/api/lobbies/:id`                                     | Карточка встречи; точное место — только хосту и одобренным участникам          |
| POST   | `/api/lobbies/:id/cancel`                              | Хост отменяет встречу до начала, с причиной                                    |
| POST   | `/api/lobbies/:id/applications`                        | Подать заявку                                                                  |
| DELETE | `/api/lobbies/:id/applications/me`                     | Отозвать свою заявку или выйти из участников (поздний выход −15 кармы)         |
| GET    | `/api/lobbies/:id/applications`                        | Хост: список заявок и участников                                               |
| POST   | `/api/lobbies/:id/applications/:applicationId/approve` | Хост одобряет заявку                                                           |
| POST   | `/api/lobbies/:id/applications/:applicationId/reject`  | Хост отклоняет заявку                                                          |
| POST   | `/api/places/suggest`                                  | Подсказки адресов DaData (если задан `DADATA_API_KEY`)                         |
| POST   | `/api/places/reverse`                                  | Адрес по точке на карте через DaData                                           |
