<script lang="ts">
  import { toast } from '#lib/stores/toast.svelte.js';
</script>

<!-- Announced politely; tapping a toast dismisses it. -->
<div
  role="status"
  aria-live="polite"
  class="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-[max(var(--safe-top),0.75rem)]"
>
  {#each toast.items as item (item.id)}
    <button
      type="button"
      class="pointer-events-auto w-full max-w-md rounded-2xl border px-4 py-3 text-left text-[0.9375rem] shadow-lg backdrop-blur {item.tone ===
      'error'
        ? 'border-brand-deep/60 bg-ink/90 text-paper'
        : item.tone === 'success'
          ? 'border-brand/60 bg-ink/90 text-paper'
          : 'border-gray-dark bg-ink/90 text-paper'}"
      onclick={() => toast.dismiss(item.id)}
    >
      {item.text}
    </button>
  {/each}
</div>
