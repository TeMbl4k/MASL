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
   * Каталог сборки Mini App (apps/web/build). Если в нём есть index.html,
   * API отдаёт Mini App с того же домена; иначе пишет предупреждение и работает
   * только API (так в разработке, где Mini App отдаёт Vite).
   */
  webDistDir?: string;
}

/** Собирает приложение; используется и в main.ts, и в e2e-тестах. */
export async function createApp(env: Env, options: CreateAppOptions = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    // Railway и другие хостинги стоят за прокси.
    new FastifyAdapter({ trustProxy: true }),
    { logger: options.logger === false ? false : undefined },
  );
  app.setGlobalPrefix(API_PREFIX);
  // CORS нужен, только если Mini App открывается с другого домена.
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
