import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      // SPA: все маршруты отдаются через index.html, рендер только на клиенте.
      adapter: adapter({ fallback: 'index.html' }),
    }),
  ],
  server: {
    // Туннель для проверки в Telegram: cloudflared tunnel --url http://localhost:5173
    allowedHosts: ['.trycloudflare.com'],
    // API на том же домене, как в продакшене: один туннель на всё и без CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    expect: { requireAssertions: true },
    passWithNoTests: true,
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
