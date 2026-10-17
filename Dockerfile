# Image for Railway (or any Docker host): one process serves both the Mini App and the API under /api.
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Build the whole monorepo.
FROM base AS build
# Lockfile first: the package layer stays cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm build

# Production dependencies only, for the API and its packages (@masl/db, @masl/shared).
# When the API starts depending on a new workspace package, add it here too.
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
# Run migrations before start, so the host needs no separate setup for them.
CMD ["sh", "-c", "node packages/db/dist/bin/migrate.js && exec node apps/api/dist/main.js"]
