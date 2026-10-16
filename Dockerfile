# Образ для Railway (и любого Docker-хостинга): один процесс отдаёт и Mini App, и API на /api.
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Сборка всего монорепозитория.
FROM base AS build
# Сначала только lock-файл: слой с пакетами кэшируется, пока зависимости не менялись.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm build

# Только рабочие зависимости API и его пакетов (@masl/db, @masl/shared).
# Новый пакет в монорепозитории, от которого зависит API, добавьте сюда же.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @masl/api...

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app ./
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/drizzle packages/db/drizzle
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/build apps/web/build
USER node
EXPOSE 3000
# Миграции перед стартом: отдельной настройки на хостинге не нужно.
CMD ["sh", "-c", "node packages/db/dist/bin/migrate.js && exec node apps/api/dist/main.js"]
