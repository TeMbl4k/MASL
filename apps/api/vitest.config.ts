import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // e2e поднимает отдельную базу на каждый файл, держим файлы последовательно.
    fileParallelism: false,
  },
});
