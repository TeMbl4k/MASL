import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // e2e creates a separate database per file, so run files sequentially.
    fileParallelism: false,
  },
});
