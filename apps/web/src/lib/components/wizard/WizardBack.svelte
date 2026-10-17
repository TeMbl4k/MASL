<script lang="ts">
  import { back } from '#lib/tg/back.svelte.js';
  import ChevronLeft from '../icons/ChevronLeft.svelte';
</script>

<!-- The tab bar is hidden on /create: this is the way out when Telegram's BackButton isn't mounted. -->
{#if !back.native}
  <button
    type="button"
    class="-ml-2 flex min-h-11 items-center gap-1 self-start px-2 text-gray-light"
    onclick={() => back.go()}
  >
    <ChevronLeft size={20} />
    Назад
  </button>
{/if}
