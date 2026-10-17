import { describeError, isAbort } from '../errors.js';
import { haptic } from '../tg/haptics.js';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

const DEFAULT_MS = 3000;
/** Older toasts are dropped beyond this. */
const MAX_TOASTS = 3;

class Toasts {
  items = $state<Toast[]>([]);
  /** A response no longer matches the app: the root layout shows «Приложение обновилось». */
  updateRequired = $state(false);
  #nextId = 1;

  show(text: string, tone: ToastTone = 'info', ms = DEFAULT_MS): void {
    const id = this.#nextId++;
    this.items = [...this.items, { id, text, tone }].slice(-MAX_TOASTS);
    setTimeout(() => this.dismiss(id), ms);
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  /** Shows a failed call: the API message, a network message, or the update screen. */
  error(error: unknown): void {
    if (isAbort(error)) return;
    const shown = describeError(error);
    if (shown.kind === 'update') {
      this.updateRequired = true;
      return;
    }
    haptic.error();
    this.show(shown.text, 'error');
  }
}

export const toast = new Toasts();
