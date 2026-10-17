import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.factory.js';
import { loadEnv } from './config/env.js';

/** Mini App build location in the monorepo: apps/api/dist/main.js → apps/web/build. */
const DEFAULT_WEB_DIST_DIR = fileURLToPath(new URL('../../web/build', import.meta.url));

const env = loadEnv();
const app = await createApp(env, { webDistDir: env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR });
await app.listen(env.PORT, '0.0.0.0');
