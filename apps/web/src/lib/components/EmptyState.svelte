<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    text?: string;
    /** Buttons or links, e.g. [Создать встречу]. */
    actions?: Snippet;
  }

  let { title, text, actions }: Props = $props();
</script>

<section
  class="flex flex-col items-center gap-3 rounded-3xl border border-gray-dark bg-gray-dark/40 px-6 py-8 text-center"
>
  <h2 class="text-xl font-semibold">{title}</h2>
  {#if text}
    <p class="text-gray-light">{text}</p>
  {/if}
  {#if actions}
    <div class="mt-2 flex flex-wrap justify-center gap-3">{@render actions()}</div>
  {/if}
</section>
