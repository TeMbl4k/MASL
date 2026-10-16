import { describe, expect, it } from 'vitest';
import { normalizeDatabaseUrl } from './client.js';

describe('normalizeDatabaseUrl', () => {
  it('убирает channel_binding из строки Neon и сохраняет sslmode', () => {
    expect(
      normalizeDatabaseUrl(
        'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      ),
    ).toBe('postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require');
  });

  it('не меняет обычную строку подключения', () => {
    expect(normalizeDatabaseUrl('postgres://masl:masl@localhost:5432/masl')).toBe(
      'postgres://masl:masl@localhost:5432/masl',
    );
  });
});
