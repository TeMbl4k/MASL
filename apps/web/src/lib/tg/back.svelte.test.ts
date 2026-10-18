import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ afterNavigate: vi.fn(), goto: vi.fn() }));
vi.mock('$app/state', () => ({
  // A tab root: Back is offered there only while a screen handler is registered.
  page: { route: { id: '/(tabs)' }, state: {}, url: new URL('https://example.test/') },
}));

const { back, useBackHandler } = await import('./back.svelte.js');

describe('useBackHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('history', { state: null, back: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the handler while the caller lives, without re-running its own effect', () => {
    const handler = vi.fn();
    const destroy = $effect.root(() => {
      useBackHandler(handler);
    });
    flushSync();
    expect(back.visible).toBe(true);
    back.go();
    expect(handler).toHaveBeenCalledTimes(1);

    destroy();
    flushSync();
    expect(back.visible).toBe(false);
    back.go();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
