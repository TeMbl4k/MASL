import { z } from 'zod';

/** Разрешённый origin для разработки, если WEB_ORIGINS не задан. */
const DEV_WEB_ORIGINS = ['http://localhost:5173'];

/** Заглушки из .env.example содержат слово replace: с ними API не стартует. */
const isPlaceholder = (value: string) => /replace/i.test(value);

/**
 * Origin вида https://masl.example — ровно то, что браузер присылает в заголовке
 * Origin. CORS сравнивает строки точно, поэтому приводим к url.origin (нижний
 * регистр, без слэша на конце) и отклоняем адреса с путём.
 */
const webOrigin = z.string().transform((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: `${value}: это не URL` });
    return z.NEVER;
  }
  const isOrigin =
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  if (!isOrigin) {
    ctx.addIssue({
      code: 'custom',
      message: `${value}: нужен только адрес сайта без пути, например https://masl.example`,
    });
    return z.NEVER;
  }
  return url.origin;
});

const webOrigins = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(webOrigin).min(1))
    .optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    BOT_TOKEN: z
      .string()
      .regex(/^\d+:[\w-]+$/, 'BOT_TOKEN должен выглядеть как 123456:ABC...')
      .refine((value) => !isPlaceholder(value), 'BOT_TOKEN не заменён: возьмите токен бота у @BotFather'),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET должен быть не короче 32 символов')
      .refine(
        (value) => !isPlaceholder(value),
        'JWT_SECRET не заменён: сгенерируйте случайную строку, например `openssl rand -hex 32`',
      ),
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(12 * 60 * 60),
    INIT_DATA_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 60 * 60),
    WEB_ORIGINS: webOrigins,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.WEB_ORIGINS) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGINS'],
        message: 'в production обязателен: адрес, с которого открывается Mini App',
      });
    }
  })
  .transform(({ WEB_ORIGINS, ...env }) => ({ ...env, WEB_ORIGINS: WEB_ORIGINS ?? DEV_WEB_ORIGINS }));

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректные переменные окружения:\n${details}`);
  }
  return parsed.data;
}
