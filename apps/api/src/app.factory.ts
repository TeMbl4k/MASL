import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { API_PREFIX, serveSpa } from './spa.js';

export interface CreateAppOptions {
  logger?: boolean;
  /**
   * Mini App build directory (apps/web/build). If it contains index.html,
   * the API serves the Mini App from the same origin; otherwise it logs a warning
   * and serves only the API (the dev setup, where Vite serves the Mini App).
   */
  webDistDir?: string;
}

/** Builds the app; shared by main.ts and the e2e tests. */
export async function createApp(env: Env, options: CreateAppOptions = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    // Railway and other hosts run behind a proxy.
    new FastifyAdapter({ trustProxy: true }),
    { logger: options.logger === false ? false : undefined },
  );
  app.setGlobalPrefix(API_PREFIX);
  // CORS is only needed when the Mini App is opened from another origin.
  if (env.WEB_ORIGINS.length > 0) {
    app.enableCors({
      origin: env.WEB_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
  }
  if (options.webDistDir) {
    if (existsSync(join(options.webDistDir, 'index.html'))) {
      serveSpa(app, options.webDistDir);
    } else {
      new Logger('MiniApp').warn(
        `Сборка Mini App не найдена в ${options.webDistDir}, отдаю только API. Соберите её: pnpm --filter @masl/web build`,
      );
    }
  }
  app.enableShutdownHooks();
  return app;
}
