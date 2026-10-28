<script lang="ts">
  import type { ShareInput, ShareResponse } from '@masl/shared';
  import { shareMessage } from '@telegram-apps/sdk';
  import { untrack, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import { describeError } from '#lib/errors.js';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { copyText } from '#lib/tg/links.js';
  import Copy from './icons/Copy.svelte';
  import Sheet from './Sheet.svelte';

  interface Props {
    /** What is shared; the link carries the viewer's public code as the source. */
    input: ShareInput;
    title: string;
    /** The card as the chat will see it. */
    preview: Snippet;
    note?: string;
  }

  let { input, title, preview, note }: Props = $props();

  const open = $derived(page.state.sheet === 'share');

  let shared = $state<ShareResponse | null>(null);
  let loadError = $state<string | null>(null);
  /** The webview refused the clipboard: the link is shown to copy by hand. */
  let showLink = $state(false);

  // The card is prepared when the sheet opens, so «Отправить в чат» opens the picker at once.
  $effect(() => {
    if (!open) return;
    untrack(() => void prepare());
  });

  async function prepare(): Promise<void> {
    shared = null;
    loadError = null;
    showLink = false;
    try {
      shared = await session.authorized((token) => api.share(token, input));
    } catch (error) {
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
    }
  }

  const canSend = $derived(
    shared?.preparedMessageId != null && session.inTelegram && shareMessage.isAvailable(),
  );

  async function send(): Promise<void> {
    const id = shared?.preparedMessageId;
    if (!id) return;
    try {
      await shareMessage(id);
      haptic.success();
      closeSheet();
    } catch {
      // Closed the chat picker, or Telegram refused: the sheet stays with «Скопировать ссылку».
    }
  }

  async function copy(): Promise<void> {
    if (!shared) return;
    if (await copyText(shared.link)) {
      haptic.success();
      toast.show('Ссылка скопирована', 'success');
      closeSheet();
    } else {
      showLink = true;
    }
  }
</script>

<Sheet name="share" {title}>
  <div class="flex flex-col gap-4">
    {@render preview()}
    {#if note}
      <p class="text-[0.8125rem] text-gray-light">{note}</p>
    {/if}
    {#if loadError}
      <p class="text-sm text-gray-light" role="alert">{loadError}</p>
      <button
        type="button"
        class="min-h-12 rounded-2xl bg-gray-dark text-lg text-paper"
        onclick={() => void prepare()}
      >
        Повторить
      </button>
    {:else}
      {#if canSend}
        <button
          type="button"
          class="min-h-12 rounded-2xl bg-brand text-lg font-bold text-paper"
          onclick={() => void send()}
        >
          Отправить в чат
        </button>
      {/if}
      <button
        type="button"
        class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-gray-dark text-[0.9375rem] disabled:opacity-50"
        disabled={!shared}
        aria-busy={!shared}
        onclick={() => void copy()}
      >
        <Copy size={18} />
        {shared ? 'Скопировать ссылку' : 'Готовим ссылку…'}
      </button>
      {#if showLink && shared}
        <p class="text-sm text-gray-light">Скопируйте ссылку вручную:</p>
        <p class="rounded-xl bg-gray-dark/60 px-3 py-2 text-sm break-all select-all">{shared.link}</p>
      {/if}
    {/if}
  </div>
</Sheet>
