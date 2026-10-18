/**
 * Pure logic of the Back button (the Telegram BackButton or the in-page «Назад»).
 * back.svelte.ts wires it to SvelteKit navigation and the SDK.
 */

/** Tab roots show the tab bar and no Back button. */
export const TAB_ROOTS: readonly string[] = ['/(tabs)', '/(tabs)/map', '/(tabs)/my', '/(tabs)/profile'];

export function isTabRoot(routeId: string | null): boolean {
  return routeId !== null && TAB_ROOTS.includes(routeId);
}

/**
 * SvelteKit's per-entry metadata in `history.state` (internal; back-stack.test.ts checks it
 * against the installed kit). Its `historyIndex` grows by one on a push or a shallow push, stays
 * on any replace (`goto(…, { replace: true })`, `data-sveltekit-replacestate`, a redirect) and is
 * restored on Back/Forward and after a reload.
 */
export const KIT_HISTORY_METADATA_KEY = 'sveltekit:metadata';

/** The entry's SvelteKit history index; null when the state doesn't carry one. */
export function historyIndexOf(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  const metadata: unknown = (state as Record<string, unknown>)[KIT_HISTORY_METADATA_KEY];
  if (typeof metadata !== 'object' || metadata === null) return null;
  const index = (metadata as { historyIndex?: unknown }).historyIndex;
  return typeof index === 'number' && Number.isFinite(index) ? index : null;
}

/**
 * In-app history entries behind the current one, counted from the entry the app started on
 * (a cold start, a deep link or a reload). An unknown index gives 0: Back then replaces the page
 * with the feed instead of risking `history.back()` out of the app.
 */
export function depthBehind(current: number | null, entry: number | null): number {
  return current === null || entry === null ? 0 : Math.max(0, current - entry);
}

export interface BackContext {
  routeId: string | null;
  /** A sheet is open (shallow-routing state). */
  sheetOpen: boolean;
  /** Screen-level handlers registered with useBackHandler (a wizard step, an inline editor). */
  handlers: number;
  /** In-app history entries behind the current one, shallow sheet entries included. */
  depth: number;
}

export function isBackVisible(context: BackContext): boolean {
  return context.handlers > 0 || context.sheetOpen || !isTabRoot(context.routeId);
}

/**
 * What a Back press does, in order: closing the open sheet (its history entry), so a sheet over
 * a wizard step closes before the step goes back (screen handlers never run while a sheet is
 * open); the top screen handler; going back in history;
 * or, on a cold deep-link entry with nothing behind it, replacing the page with the feed.
 * `history.back()` is never used with nothing behind: in Telegram Web it would navigate the parent page.
 */
export function resolveBack(context: BackContext): 'handler' | 'history' | 'home' {
  if (context.sheetOpen) return 'history';
  if (context.handlers > 0) return 'handler';
  if (context.depth > 0) return 'history';
  return 'home';
}
