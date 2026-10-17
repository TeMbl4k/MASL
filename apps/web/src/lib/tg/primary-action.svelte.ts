import { isMainButtonMounted, onMainButtonClick, setMainButtonParams } from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';
import { TG_BRAND, TG_MUTED_BG, TG_MUTED_TEXT, TG_PAPER } from './colors.js';
import { haptic } from './haptics.js';
import { fromSignal } from './signal.js';

/**
 * - ready: brand button;
 * - incomplete: enabled with muted colours, so a tap can show what is missing;
 * - disabled: muted and not tappable;
 * - loading: brand with a spinner, not tappable.
 */
export type PrimaryActionState = 'ready' | 'incomplete' | 'disabled' | 'loading';

export interface PrimaryActionOptions {
  text: string;
  visible?: boolean;
  state?: PrimaryActionState;
  onClick: () => void;
}

/** Props for `<BottomAction>` when the native MainButton isn't there. */
export interface BottomActionProps {
  text: string;
  state: PrimaryActionState;
  onclick: () => void;
}

const mainButtonMounted = fromSignal(isMainButtonMounted);

/** The screen that currently owns the MainButton; one SDK listener dispatches to it. */
let owner: { onClick: () => void } | null = null;
let listening = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  onMainButtonClick(() => owner?.onClick());
}

/**
 * Drives Telegram's MainButton from a screen. `options` is re-read reactively. Returns
 * `fallback`: props for `<BottomAction>` when the native button isn't available, otherwise null.
 *
 * ```svelte
 * const primary = usePrimaryAction(() => ({ text: 'Далее', state: complete ? 'ready' : 'incomplete', onClick: next }));
 * {#if primary.fallback}<BottomAction {...primary.fallback} />{/if}
 * ```
 */
export function usePrimaryAction(options: () => PrimaryActionOptions): {
  readonly fallback: BottomActionProps | null;
} {
  const native = $derived(session.inTelegram && mainButtonMounted.current);
  const token = {
    onClick: () => {
      const { state = 'ready', onClick } = options();
      if (state === 'ready' || state === 'incomplete') {
        if (state === 'ready') haptic.action();
        onClick();
      }
    },
  };

  $effect(() => {
    if (!native) return;
    const { text, visible = true, state = 'ready' } = options();
    ensureListener();
    owner = token;
    const muted = state === 'incomplete' || state === 'disabled';
    setMainButtonParams({
      text,
      isVisible: visible,
      isEnabled: state === 'ready' || state === 'incomplete',
      isLoaderVisible: state === 'loading',
      backgroundColor: muted ? TG_MUTED_BG : TG_BRAND,
      textColor: muted ? TG_MUTED_TEXT : TG_PAPER,
    });
  });

  $effect(() => {
    if (!native) return;
    return () => {
      // Another screen may already own the button (navigation mounts it first).
      if (owner !== token) return;
      owner = null;
      setMainButtonParams({ isVisible: false, isLoaderVisible: false });
    };
  });

  return {
    get fallback(): BottomActionProps | null {
      if (native) return null;
      const { text, visible = true, state = 'ready' } = options();
      return visible ? { text, state, onclick: token.onClick } : null;
    },
  };
}
