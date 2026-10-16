import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://masl:masl@localhost:5432/masl',
  },
  // Таблицы PostGIS (spatial_ref_sys и т.п.) не наши — не трогаем.
  extensionsFilters: ['postgis'],
});
