<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { closeSheet } from '#lib/tg/back.svelte.js';
  import Close from './icons/Close.svelte';

  type SheetName = NonNullable<App.PageState['sheet']>;

  interface Props {
    /** Open while `page.state.sheet` equals it; open with `openSheet(name)` from tg/back.svelte.ts. */
    name: SheetName;
    title: string;
    /** Inline before the title text, e.g. metro line dots. */
    titlePrefix?: Snippet;
    children: Snippet;
    /** Sticky bottom area, e.g. the «Сохранить» button. */
    footer?: Snippet;
  }

  let { name, title, titlePrefix, children, footer }: Props = $props();

  const open = $derived(page.state.sheet === name);
  const titleId = $derived(`sheet-${name}-title`);

  let dialog = $state<HTMLElement | null>(null);

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    return dialog ? [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep focus inside the sheet.
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  });
</script>

{#if open}
  <div class="fixed inset-0 z-40 flex flex-col justify-end">
    <button
      type="button"
      tabindex="-1"
      aria-label="Закрыть"
      class="absolute inset-0 bg-ink/70"
      onclick={() => closeSheet()}
    ></button>
    <div
      bind:this={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      {onkeydown}
      class="relative mx-auto flex max-h-[min(85dvh,calc(100dvh-var(--safe-top)-1rem))] w-full max-w-lg flex-col rounded-t-3xl border-t border-gray-dark bg-[color-mix(in_srgb,var(--color-gray-dark)_40%,var(--color-ink))] outline-none"
    >
      <div class="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-gray-dark" aria-hidden="true"></div>
      <div class="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
        <h2 id={titleId} class="flex min-w-0 items-center gap-2 text-lg font-semibold">
          {@render titlePrefix?.()}
          <span class="min-w-0">{title}</span>
        </h2>
        <button
          type="button"
          aria-label="Закрыть"
          class="-mr-2 flex size-11 items-center justify-center rounded-full text-gray-light"
          onclick={() => closeSheet()}
        >
          <Close size={20} />
        </button>
      </div>
      <div
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(var(--safe-bottom)+1.25rem)]"
      >
        {@render children()}
      </div>
      {#if footer}
        <div class="shrink-0 border-t border-gray-dark px-5 pt-3 pb-[calc(var(--safe-bottom)+1rem)]">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
