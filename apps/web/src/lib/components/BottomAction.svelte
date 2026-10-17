<script lang="ts">
  import type { PrimaryActionState } from '#lib/tg/primary-action.svelte.js';

  interface Props {
    text: string;
    state?: PrimaryActionState;
    onclick: () => void;
  }

  let { text, state = 'ready', onclick }: Props = $props();

  const muted = $derived(state === 'incomplete' || state === 'disabled');
</script>

<!--
  In-page stand-in for Telegram's MainButton (outside Telegram or on old clients). A spacer keeps
  the end of the page reachable above the fixed button.
-->
<div aria-hidden="true" class="h-28"></div>
<div
  class="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ink via-ink/90 to-transparent px-5 pt-6 pb-[calc(var(--safe-bottom)+1.25rem)]"
>
  <button
    type="button"
    class="mx-auto block w-full max-w-lg rounded-2xl py-4 text-xl font-bold transition active:scale-[0.99] {muted
      ? 'bg-gray-dark text-gray-light'
      : 'bg-brand text-paper'}"
    disabled={state === 'disabled' || state === 'loading'}
    aria-busy={state === 'loading'}
    {onclick}
  >
    {state === 'loading' ? 'Подождите…' : text}
  </button>
</div>
