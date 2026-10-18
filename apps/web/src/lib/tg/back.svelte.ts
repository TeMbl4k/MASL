import { hideBackButton, isBackButtonMounted, onBackButtonClick, showBackButton } from '@telegram-apps/sdk';
import { afterNavigate, goto } from '$app/navigation';
import { page } from '$app/state';
import { tick, untrack } from 'svelte';
import { session } from '../session.svelte.js';
import { depthBehind, historyIndexOf, isBackVisible, resolveBack } from './back-stack.js';
import { haptic } from './haptics.js';
import { fromSignal } from './signal.js';

type Sheet = NonNullable<App.PageState['sheet']>;

const backButtonMounted = fromSignal(isBackButtonMounted);

/**
 * Back navigation for the whole app: the Telegram BackButton when it is mounted, the in-page
 * «Назад» of `<PageHeader>` otherwise. Both call `back.go()`.
 */
class BackController {
  /** SvelteKit's history index of the entry the app started on (or was reloaded at). */
  #entryIndex: number | null = null;
  #handlers = $state<(() => void)[]>([]);

  /** The native BackButton is in use, so pages don't render their own. */
  get native(): boolean {
    // Read the signal first: `inTelegram` is not reactive, and a reader that skipped the signal
    // while it was still false would never re-run once the button is mounted.
    const mounted = backButtonMounted.current;
    return mounted && session.inTelegram;
  }

  /** Back is offered on this page: a nested route, an open sheet or a screen handler. */
  get visible(): boolean {
    return isBackVisible(this.#context());
  }

  #context() {
    return {
      routeId: page.route.id,
      sheetOpen: page.state.sheet !== undefined,
      handlers: this.#handlers.length,
      // Read at use: a replace of any kind keeps the index, so it never inflates the depth.
      depth: depthBehind(historyIndexOf(history.state), this.#entryIndex),
    };
  }

  go(): void {
    switch (resolveBack(this.#context())) {
      case 'handler':
        this.#handlers.at(-1)?.();
        return;
      case 'history':
        history.back();
        return;
      case 'home':
        void goto('/', { replace: true });
    }
  }

  /** Called on the app's first navigation (a cold start, a deep link or a reload). */
  enter(): void {
    this.#entryIndex = historyIndexOf(history.state);
  }

  /**
   * Registers a screen handler; the returned function removes it. Reads the list untracked, so
   * an effect that calls this does not depend on the list it writes and re-run itself.
   */
  addHandler(handler: () => void): () => void {
    untrack(() => {
      this.#handlers = [...this.#handlers, handler];
    });
    return () => {
      untrack(() => {
        this.#handlers = this.#handlers.filter((h) => h !== handler);
      });
    };
  }
}

export const back = new BackController();

/** Opens a sheet as a shallow history entry, so Back (native or system) closes it. */
export function openSheet(sheet: Sheet, extra: Omit<App.PageState, 'sheet'> = {}): Promise<void> {
  haptic.tap();
  return goto(page.url.href, { state: { ...page.state, ...extra, sheet }, shallow: true });
}

/**
 * Replaces the open sheet with another one in the same history entry (the origin sheet hands
 * over to the station picker), so one Back still returns to the page.
 */
export function switchSheet(sheet: Sheet, extra: Omit<App.PageState, 'sheet'> = {}): Promise<void> {
  if (page.state.sheet === undefined) return openSheet(sheet, extra);
  haptic.tap();
  return goto(page.url.href, { state: { ...page.state, ...extra, sheet }, shallow: true, replace: true });
}

/** Closes the open sheet by going back to the entry under it. */
export function closeSheet(): void {
  if (page.state.sheet !== undefined) history.back();
}

/**
 * A screen-level Back handler (a wizard step going to the previous step) while the calling
 * component is mounted. Handlers registered later run first.
 */
export function useBackHandler(handler: () => void): void {
  $effect(() => back.addHandler(handler));
}

let clickListener: (() => void) | undefined;

/** Wires Back to navigation and to the Telegram BackButton. Call once, in the root layout. */
export function useBackController(): void {
  afterNavigate((navigation) => {
    if (navigation.type === 'enter') {
      back.enter();
    } else if (!navigation.shallow) {
      // Move focus to the new page's heading for screen readers.
      void tick().then(() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }));
    }
  });

  $effect(() => {
    if (!back.native) return;
    clickListener ??= onBackButtonClick(() => back.go());
    if (back.visible) showBackButton();
    else hideBackButton();
  });
}
