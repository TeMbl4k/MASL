import { hideBackButton, isBackButtonMounted, onBackButtonClick, showBackButton } from '@telegram-apps/sdk';
import { afterNavigate, goto } from '$app/navigation';
import { page } from '$app/state';
import { tick } from 'svelte';
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
    return session.inTelegram && backButtonMounted.current;
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

  addHandler(handler: () => void): () => void {
    this.#handlers = [...this.#handlers, handler];
    return () => {
      this.#handlers = this.#handlers.filter((h) => h !== handler);
    };
  }
}

export const back = new BackController();

/** Opens a sheet as a shallow history entry, so Back (native or system) closes it. */
export function openSheet(sheet: Sheet, extra: Omit<App.PageState, 'sheet'> = {}): Promise<void> {
  haptic.tap();
  return goto(page.url.href, { state: { ...page.state, ...extra, sheet }, shallow: true });
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
