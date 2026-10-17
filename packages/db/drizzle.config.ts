import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://masl:masl@localhost:5432/masl',
  },
  // PostGIS tables (spatial_ref_sys etc.) aren't ours; leave them alone.
  extensionsFilters: ['postgis'],
});
