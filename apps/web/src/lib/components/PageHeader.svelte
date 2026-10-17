<script lang="ts">
  import type { Snippet } from 'svelte';
  import { back } from '#lib/tg/back.svelte.js';
  import ChevronLeft from './icons/ChevronLeft.svelte';

  interface Props {
    title: string;
    subtitle?: string;
    /** Right side of the header: an action or a pill. */
    right?: Snippet;
  }

  let { title, subtitle, right }: Props = $props();
</script>

<header class="flex flex-col gap-3 px-5 pt-5">
  <!-- Telegram's own BackButton replaces this one when it is mounted. -->
  {#if back.visible && !back.native}
    <button
      type="button"
      class="-ml-2 flex min-h-11 items-center gap-1 self-start px-2 text-gray-light"
      onclick={() => back.go()}
    >
      <ChevronLeft size={20} />
      Назад
    </button>
  {/if}
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 space-y-1">
      <h1 tabindex="-1" class="text-3xl font-light tracking-tight break-words outline-none">{title}</h1>
      {#if subtitle}
        <p class="text-sm text-gray-light">{subtitle}</p>
      {/if}
    </div>
    {#if right}
      <div class="shrink-0">{@render right()}</div>
    {/if}
  </div>
</header>
