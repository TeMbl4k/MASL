import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  depthBehind,
  historyIndexOf,
  isBackVisible,
  isTabRoot,
  KIT_HISTORY_METADATA_KEY,
  resolveBack,
} from './back-stack.js';

const entry = (historyIndex: unknown) => ({ [KIT_HISTORY_METADATA_KEY]: { historyIndex } });

describe('historyIndexOf', () => {
  it('reads the index SvelteKit keeps in history.state', () => {
    expect(historyIndexOf(entry(1_760_000_000_002))).toBe(1_760_000_000_002);
  });

  it('gives null for a state without a usable index', () => {
    expect(historyIndexOf(null)).toBeNull();
    expect(historyIndexOf({})).toBeNull();
    expect(historyIndexOf({ [KIT_HISTORY_METADATA_KEY]: null })).toBeNull();
    expect(historyIndexOf(entry('3'))).toBeNull();
    expect(historyIndexOf(entry(Number.NaN))).toBeNull();
  });

  it('matches the history layout of the installed SvelteKit', () => {
    // An upgrade that changes this layout must fail here, not silently send Back to the feed.
    const kit = dirname(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json'));
    const client = join(kit, 'src/runtime/client');
    expect(readFileSync(join(client, 'constants.js'), 'utf8')).toContain(
      `export const HISTORY_METADATA_KEY = '${KIT_HISTORY_METADATA_KEY}';`,
    );
    const source = readFileSync(join(client, 'client.js'), 'utf8');
    // Navigations: +1 on a push, 0 on a replace.
    expect(source).toContain('const change = replace_state ? 0 : 1;');
    expect(source).toContain('historyIndex: (current_history_index += change)');
    // Shallow entries (sheets) count the same way.
    expect(source).toContain('historyIndex: (current_history_index += replace ? 0 : 1)');
  });
});

describe('depthBehind', () => {
  it('counts the entries behind the app entry', () => {
    expect(depthBehind(1002, 1000)).toBe(2);
    expect(depthBehind(1000, 1000)).toBe(0);
  });

  it('is 0 when the index is unknown or before the entry', () => {
    expect(depthBehind(null, 1000)).toBe(0);
    expect(depthBehind(1002, null)).toBe(0);
    expect(depthBehind(998, 1000)).toBe(0);
  });
});

describe('resolveBack', () => {
  const base = { routeId: '/lobby/[id=uuid]', sheetOpen: false, handlers: 0, depth: 0 };

  it('falls back to the feed on a cold deep-link entry instead of leaving the app', () => {
    expect(resolveBack(base)).toBe('home');
  });

  it('goes back in history when there is an in-app entry behind', () => {
    expect(resolveBack({ ...base, depth: 1 })).toBe('history');
  });

  it('closes an open sheet through history, even at depth 0', () => {
    expect(resolveBack({ ...base, sheetOpen: true })).toBe('history');
  });

  it('lets a screen handler go before history', () => {
    expect(resolveBack({ ...base, handlers: 1, depth: 3 })).toBe('handler');
  });

  it('closes a sheet before the screen handler runs', () => {
    expect(resolveBack({ ...base, handlers: 1, sheetOpen: true, depth: 3 })).toBe('history');
  });
});

describe('isBackVisible', () => {
  it('hides Back on tab roots and shows it on nested pages', () => {
    expect(isTabRoot('/(tabs)')).toBe(true);
    expect(isTabRoot('/create')).toBe(false);
    expect(isBackVisible({ routeId: '/(tabs)/map', sheetOpen: false, handlers: 0, depth: 2 })).toBe(false);
    expect(isBackVisible({ routeId: '/lobby/[id=uuid]', sheetOpen: false, handlers: 0, depth: 0 })).toBe(
      true,
    );
    // The 404 page has no route id.
    expect(isBackVisible({ routeId: null, sheetOpen: false, handlers: 0, depth: 0 })).toBe(true);
  });

  it('shows Back on a tab root while a sheet or a handler is open', () => {
    expect(isBackVisible({ routeId: '/(tabs)', sheetOpen: true, handlers: 0, depth: 0 })).toBe(true);
    expect(isBackVisible({ routeId: '/(tabs)', sheetOpen: false, handlers: 1, depth: 0 })).toBe(true);
  });
});
