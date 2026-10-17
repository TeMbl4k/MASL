# Известные баги и грабли

## Открытые баги

Пока нет.

## Грабли: не трогать без понимания

### База и миграции

- **drizzle-kit берёт `geography(Point, 4326)` в кавычки** в сгенерированном SQL, и PostgreSQL такой тип не находит. После `pnpm db:generate` уберите кавычки вручную. Тест миграций в `packages/db/src/geo.integration.test.ts` это ловит.
- **Drizzle заворачивает ошибку драйвера в `DrizzleQueryError`**: код ошибки (`ECONNREFUSED`, `57P03`) лежит в `.cause`, а не в самой ошибке. См. `errorCode()` в `packages/db/src/bin/migrate.ts`.
- **postgres.js передаёт неизвестные параметры строки подключения серверу** как настройки сессии, и подключение падает. Neon добавляет `channel_binding=require`: его убирает `normalizeDatabaseUrl()` в `packages/db/src/client.ts`.
- **Advisory lock миграций держится на соединении**: через пул в режиме транзакций (pgbouncer, Neon pooling) он не работает. Для миграций нужно прямое подключение.

### API

- **`@telegram-apps/init-data-node`: `parse()` требует поле `signature`** и не переводит ключи `user` в camelCase. Поэтому после `validate()` поля `user` разбираем сами.
- **В Nest-провайдерах всегда явный `@Inject(...)`**: в vitest нет `emitDecoratorMetadata`, и без явного токена зависимость приходит `undefined`.
- **`@fastify/static`: в `setHeaders` приходит `FastifyReply`**, а тип в Nest объявлен неверно. Приводим тип и вызываем `reply.header()`.
- **Не вызывать `setNotFoundHandler`**: Nest уже ставит свой, и второй вызов падает. Фолбэк SPA сделан маршрутом `GET /*` с `reply.callNotFound()` для `/api`, `/_app` и путей с расширением.

### Веб

- **SvelteKit 3: алиас `#lib`**, а не `$lib`; конфиг Kit лежит в `vite.config.ts`.
- **`mockTelegramEnv` требует `signature` в initData**, иначе SDK падает в разработке.

### Сборка и деплой

- **Прод-установка зависимостей с `--ignore-scripts`**: иначе запускается `prepare` веба (`svelte-kit sync`), которому нужны dev-зависимости.
- **TypeScript ~6.0**: не обновлять до 7, пока SvelteKit 3 и typescript-eslint его не поддерживают.
- **Docker Hub из России бывает недоступен**: `deploy/install.sh` тогда подключает зеркала (`dockerhub.timeweb.cloud`, `mirror.gcr.io`). Пакеты Docker ставим из репозитория Ubuntu, `download.docker.com` тоже может не открываться.
- **С российских серверов недоступен `api.telegram.org`** (с марта 2026). Сервер для бота — за рубежом или через релей.
- **Временный туннель cloudflared меняет адрес** при каждом перезапуске: новый адрес нужно снова указать в @BotFather → Menu Button.
