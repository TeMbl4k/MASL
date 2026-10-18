<script lang="ts">
  import Alert from './icons/Alert.svelte';

  interface Props {
    title: string;
    /** The API's or the network's message. */
    message?: string | null;
    onretry?: () => void;
    retryText?: string;
  }

  let { title, message, onretry, retryText = 'Обновить' }: Props = $props();
</script>

<section
  role="alert"
  class="flex flex-col items-center gap-3 rounded-3xl border border-gray-dark bg-gray-dark/40 px-6 py-8 text-center"
>
  <Alert size={28} class="text-brand" />
  <h2 class="text-xl font-semibold">{title}</h2>
  {#if message}
    <p class="text-gray-light">{message}</p>
  {/if}
  {#if onretry}
    <button
      type="button"
      class="mt-2 min-h-11 rounded-2xl bg-brand px-6 text-lg font-bold text-paper"
      onclick={onretry}
    >
      {retryText}
    </button>
  {/if}
</section>
