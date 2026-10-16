import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

/** Собирает приложение; используется и в main.ts, и в e2e-тестах. */
export async function createApp(
  env: Env,
  options: { logger?: boolean } = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    // Railway и другие хостинги стоят за прокси.
    new FastifyAdapter({ trustProxy: true }),
    { logger: options.logger === false ? false : undefined },
  );
  app.enableCors({
    origin: env.WEB_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  app.enableShutdownHooks();
  return app;
}
