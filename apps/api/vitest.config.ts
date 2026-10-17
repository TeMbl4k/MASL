import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'src/**/*.integration.test.ts', 'test/**/*.e2e-spec.ts'],
    // e2e creates a separate database per file, so run files sequentially.
    fileParallelism: false,
    // e2e cases make many requests against a real database; the 5 s default flakes under load.
    testTimeout: 20_000,
  },
});
