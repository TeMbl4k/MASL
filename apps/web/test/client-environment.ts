import type { Environment } from 'vitest/environments';

/** Node globals with the client transform, so runes modules run their effects in tests. */
export default {
  name: 'client-node',
  viteEnvironment: 'client',
  setup() {
    return { teardown() {} };
  },
} satisfies Environment;
