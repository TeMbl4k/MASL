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
      // SPA: every route falls back to index.html, rendering is client-only.
      adapter: adapter({ fallback: 'index.html' }),
    }),
  ],
  server: {
    // Tunnel for testing inside Telegram: cloudflared tunnel --url http://localhost:5173
    allowedHosts: ['.trycloudflare.com'],
    // API on the same origin as in production: one tunnel for everything and no CORS.
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
      {
        extends: './vite.config.ts',
        // Runes modules compiled for the client, so $effect runs; no DOM is needed.
        resolve: { conditions: ['browser'] },
        test: {
          name: 'client',
          environment: './test/client-environment.ts',
          server: { deps: { inline: ['svelte'] } },
          include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
