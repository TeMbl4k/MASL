import type { Provider } from '@nestjs/common';
import { Bot } from 'grammy';
import { ENV, type Env } from '../config/env.js';

/** The grammY bot of BOT_TOKEN: updates by long polling (BotRunner), API calls from anywhere. */
export const BOT = Symbol('BOT');

export const botProvider: Provider = {
  provide: BOT,
  inject: [ENV],
  useFactory: (env: Env) => new Bot(env.BOT_TOKEN),
};
