import { hideKeyboard } from '@telegram-apps/sdk';

/** Hides the on-screen keyboard (Bot API 9.1), or blurs the focused field. */
export function dismissKeyboard(): void {
  if (hideKeyboard.isAvailable()) {
    hideKeyboard();
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}
