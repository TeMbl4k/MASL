# Известные баги и грабли

## Открытые баги

- **`origin.restore()` при втором одновременном вызове возвращается раньше**, чем станция восстановлена (флаг ставится сразу, модуль метро грузится асинхронно). Сейчас вызов один, ничего не ломается; если вызовов станет больше, хранить и возвращать общий промис.

## Грабли: не трогать без понимания

### База и миграции

- **drizzle-kit берёт `geography(Point, 4326)` в кавычки** в сгенерированном SQL, и PostgreSQL такой тип не находит. После `pnpm db:generate` уберите кавычки вручную. Тест миграций в `packages/db/src/geo.integration.test.ts` это ловит. В `0002` пришлось снова чистить `public_location`; `lobbies.integration.test.ts` проверяет её тип и `NOT NULL`.
- **Локальную базу с лобби, вставленными руками до этапа 2, нужно пересоздать:** миграция `0002` добавляет `metro_station_id` и `public_location` как `NOT NULL` без значения по умолчанию. Удалите том, затем `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`.
- **Тесты, которые вставляют лобби напрямую, обязаны задать `metroStationId`, `publicLocation` и `placeHint`**: берите их из `nearestStation()` и `placeHint()` в `@masl/shared/metro`, как `lobbyValues`/`publicPlace` в тестах.
- **postgres.js под Drizzle не передаёт `Date` в сыром `` sql`${date}` ``** («The "string" argument must be of type string… Received an instance of Date»). Используйте `at(date)` из `apps/api/src/lobbies/lobby-queries.ts` (ISO-строка с `::timestamptz`) или операторы Drizzle по столбцу.
- **Сырой `db.execute()` возвращает `timestamptz` и `numeric` строками**, а не `Date` и числом.
- **`GROUP BY` по выражению с параметром** (`at time zone $1`) не совпадает с тем же выражением в `SELECT`: у них разные номера параметров. Группируйте по номеру столбца: ``groupBy(sql`1`)``.
- **Суточный лимит заявок считает `application_events`, а не `lobby_members`:** тест, который заводит заявки через `setMembership`, для лимита должен добавить и строки журнала (сдвиг окна — `shiftCreatedAt(db, 'application_events', userId, …)`).
- **Drizzle в выборке из одной таблицы пишет столбцы без имени таблицы.** Проверка SQL на утечку точного места ищет `"location"`/`"address"`, а не только `"lobbies"."location"`.
- **Drizzle заворачивает ошибку драйвера в `DrizzleQueryError`**: код ошибки (`ECONNREFUSED`, `57P03`) лежит в `.cause`, а не в самой ошибке. См. `errorCode()` в `packages/db/src/bin/migrate.ts`.
- **postgres.js передаёт неизвестные параметры строки подключения серверу** как настройки сессии, и подключение падает. Neon добавляет `channel_binding=require`: его убирает `normalizeDatabaseUrl()` в `packages/db/src/client.ts`.
- **Advisory lock миграций держится на соединении**: через пул в режиме транзакций (pgbouncer, Neon pooling) он не работает. Для миграций нужно прямое подключение.

### API

- **`@telegram-apps/init-data-node`: `parse()` требует поле `signature`** и не переводит ключи `user` в camelCase. Поэтому после `validate()` поля `user` разбираем сами.
- **В логах нельзя писать текст, параметры и `cause.detail` ошибок базы:** `DrizzleQueryError` кладёт параметры запроса (адрес, EWKT) в `message`, а `detail` у 23514 содержит всю строку. Пишите только класс, `pgCode`, `constraint` и шаблон маршрута (`request.routeOptions.url`, не `request.url` — там координаты зрителя), как `RedactingExceptionFilter`.
- **У `DrizzleQueryError` `name` равен `'Error'`:** полезное имя — только `error.constructor.name`.
- **Без глобального фильтра Nest логирует ошибку целиком:** если из `app.module.ts` пропадёт `APP_FILTER`, `BaseExceptionFilter` напишет SQL и параметры. Это ловит `apps/api/test/errors.e2e-spec.ts` на настоящем маршруте — его нельзя удалять или ослаблять.
- **POST без тела через туннель или прокси даёт 415.** cloudflared пересылает пустое тело как `Transfer-Encoding: chunked` без `Content-Type`, и Fastify отвечает «Unsupported Media Type» ещё до проверки входа (так ломалось «Одобрить» и «Отклонить»). Все изменяющие запросы без данных шлют `{}` с `application/json` (`apps/web/src/lib/api.ts`).
- **Ошибки клиента Fastify (битый JSON, 413, 415) приходят в фильтр уже как `HttpException`**, с английским текстом и без `code`. Ветка «ошибка Fastify» в фильтре не срабатывала бы никогда, поэтому её нет.
- **Хранимый статус встречи отстаёт от фактического** на интервал службы статусов (до 60 с). Любое решение берите по времени: `effectiveLobbyStatus()` или `effectiveStatusSql(now)`.
- **vitest fake timers не управляют `AbortSignal.timeout`:** таймаут DaData сделан через `AbortController` и `setTimeout`.
- **При `logger: false` в `createApp` вызовы `Logger.prototype.log` всё равно идут:** лог запуска в e2e проверяется через `vi.spyOn(Logger.prototype, 'log')` до запуска приложения.
- **Проверка «чего-то нет в логе» осмысленна, только если тест сначала убедился, что строка лога вообще появилась** (так было с ключом DaData: после одной ошибки 500 клиент ещё ничего не пишет).
- **Тестовые данные для фильтра подсказок должны попадать в первые `PLACE_SUGGESTIONS_MAX` элементов**, иначе их отбрасывает обрезка списка, а не проверяемый фильтр.
- **e2e под нагрузкой медленные:** в `apps/api/vitest.config.ts` `testTimeout` поднят до 20 с, стандартные 5 с флакали на общем PostGIS. `packages/db/src/migrate.integration.test.ts` на стандартных 5 с один раз упал по таймауту в полном прогоне turbo.
- **В Nest-провайдерах всегда явный `@Inject(...)`**: в vitest нет `emitDecoratorMetadata`, и без явного токена зависимость приходит `undefined`.
- **`@fastify/static`: в `setHeaders` приходит `FastifyReply`**, а тип в Nest объявлен неверно. Приводим тип и вызываем `reply.header()`.
- **Не вызывать `setNotFoundHandler`**: Nest уже ставит свой, и второй вызов падает. Фолбэк SPA сделан маршрутом `GET /*` с `reply.callNotFound()` для `/api`, `/_app` и путей с расширением.

### Веб

- **SvelteKit 3: алиас `#lib`**, а не `$lib`; конфиг Kit лежит в `vite.config.ts`.
- **`mockTelegramEnv` требует `signature` в initData**, иначе SDK падает в разработке.
- **Под `mockTelegramEnv` нативные вызовы, ждущие ответа клиента, висят вечно** (`showPopup`, `requestLocation`, монтирования): `postEvent` без `onEvent` пустой. Перед такими вызовами проверяйте `session.inTelegram`, а не только `.isAvailable()`; асинхронные `mount*` — всегда с таймаутом.
- **SvelteKit 3:** шаблоны параметров — в `src/params.ts` через `defineParams`; старый `src/params/<name>.ts` молча не подключается. `goto(url, { replaceState })` устарел — используйте `{ replace: true }`. `preloadCode` принимает id маршрута (`'/(tabs)/map'`), а не путь. `goto` не принимает `page.url` по типам — передавайте `page.url.href`.
- **Тесты рун (`*.svelte.test.ts`) идут в проекте vitest `client`:** окружение `test/client-environment.ts` (`viteEnvironment: 'client'`), условие `browser` и `svelte` в `server.deps.inline`. Без любого из трёх модуль компилируется или грузится серверным, и `$effect` молча не выполняется — тест проходит или падает не по той причине.
- **Функция, которую зовут из `$effect` и которая читает и пишет один `$state`, должна делать это в `untrack`** (так `back.addHandler`), иначе эффект зависит от того, что пишет, и зацикливается (`effect_update_depth_exceeded`).
- **Svelte 5: в `$effect`/`$derived` сначала читайте сигнал, потом нереактивное условие.** `session.inTelegram && signal()` при первом запуске с `false` не подписывается на сигнал, и эффект больше не перезапустится (так кнопка «Назад» Telegram не появлялась).
- **`requestLocation` из `@telegram-apps/sdk` 3.11.8 возвращает сырые поля в snake_case** (`latitude`, `longitude`, …). Отказ одни клиенты выдают исключением, другие — ответом без координат. После отказа SDK ставит `available: false` и не перепроверяет: после неудачи вызываем `unmountLocationManager()`. После перезагрузки страницы состояние берётся из `sessionStorage` SDK.
- **Главная кнопка Telegram — один обработчик на всё приложение** (`usePrimaryAction`): `onMainButtonClick` в каждом экране копит обработчики.
- **MapLibre 6: воркер импортирует общий чанк `maplibre-gl-shared.mjs`**, обычный URL ломается. Подключать через `?worker&url` и `setWorkerUrl`.
- **MapLibre `setHTML` — XSS:** попапы и маркеры только через `setDOMContent`/`textContent`; `no-unsafe-html.test.ts` это проверяет.
- **MapLibre: `isStyleLoaded()` ложно, пока грузится хоть один тайл.** Ошибку стиля отличать от ошибки тайла по событию `style.load`, иначе пара упавших тайлов «ломает» карту (см. `attachStyleFallback` в `lib/map/style.ts`).
- **CSS MapLibre вне слоя задаёт `.maplibregl-map { position: relative }`** и перебивает Tailwind-класс `absolute`: контейнеру карты нужна обёртка или явный размер (`size-full`).
- **Компактная атрибуция MapLibre раскрыта при загрузке** и закрывает ~50 px снизу: плавающие кнопки карты подняты (`pb-16`).
- **Карта создаётся асинхронно** (ленивый чанк): текущее состояние (центр) читайте в момент создания карты, а не в `onMount`.
- **Макет `(tabs)` добавляет нижний отступ «таб-бар + safe area + 1rem»:** полноэкранному экрану нужен `-mb-4`, иначе он прокручивается на 16 px.
- **Экран, показывающий расстояние, должен вызвать `origin.restore()` до запроса** (как лента и страница встречи), иначе при холодном переходе по ссылке расстояния нет.
- **Chrome: `scrollIntoView({ block: 'nearest' })` не учитывает `scroll-margin`** у частично видимого элемента; под фиксированной кнопкой нужен `block: 'end'` и `scroll-mb-*`.

### Общие пакеты

- **`z.coerce.number()` даёт 0 для `''` и `' '`:** `''` в запросе сначала превращается в `undefined` (`emptyToUndefined`), а `' '` ловят диапазон координат и `min(1)` у `limit`.
- **zod 4 падает на `.pick`/`.omit` объектов с проверками на уровне объекта:** сначала собирайте простые объекты, уточнения — только на листьях.
- **zod 4: `z.iso.datetime()` требует секунды**, а `z.iso.date()` пропускает год 0000, на котором PostgreSQL падает (22008). Веб шлёт `toISOString()`, даты запроса проверяются диапазоном 2000–2099 (`moscowDate`). `z.uuid()` строгий: в фикстурах — `crypto.randomUUID()`.
- **`Date.UTC` переводит годы 0–99 в 1900-е:** в `time.ts` даты собираются через `setUTCFullYear`.
- **Невидимые символы в исходниках — только экранированием `\uXXXX`:** буквальный U+2028 в регулярке ломает разбор. В тестах на поток диакритики берите несклеиваемые знаки (U+0334…U+0336): NFC склеивает `a` + U+0301.
- **Теговые символы U+E0020–E007F вырезаются как Cf:** флаги Англии и Шотландии в названиях становятся чёрным флагом.
- **Тексты `START_ISSUE_MESSAGES` и `PLACE_TOO_FAR_MESSAGE` собраны из констант:** склонение верно только для текущих значений (15 минут, 30 дней, 5 км). Тесты закрепляют текст.
- **Копии Metro4all — с CRLF**, их нельзя «чинить»: SHA-256 в `SOURCE.md` и тест перегенерации `data.ts` сравнивают байты (закреплено в `.gitattributes`).

### Сборка и деплой

- **Прод-установка зависимостей с `--ignore-scripts`**: иначе запускается `prepare` веба (`svelte-kit sync`), которому нужны dev-зависимости.
- **TypeScript ~6.0**: не обновлять до 7, пока SvelteKit 3 и typescript-eslint его не поддерживают.
- **Docker Hub из России бывает недоступен**: `deploy/install.sh` тогда подключает зеркала (`dockerhub.timeweb.cloud`, `mirror.gcr.io`). Пакеты Docker ставим из репозитория Ubuntu, `download.docker.com` тоже может не открываться.
- **С российских серверов недоступен `api.telegram.org`** (с марта 2026). Сервер для бота — за рубежом или через релей.
- **Временный туннель cloudflared меняет адрес** при каждом перезапуске: новый адрес нужно снова указать в @BotFather → Menu Button.
