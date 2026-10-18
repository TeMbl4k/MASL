<script lang="ts">
  interface Props {
    name: string;
    src: string | null;
    /** Diameter in px. */
    size?: number;
    /** Brand ring, as on the header avatar. */
    ring?: boolean;
    class?: string;
  }

  let { name, src, size = 40, ring = false, class: className = '' }: Props = $props();

  let failed = $state(false);
  const initial = $derived(name.trim().charAt(0).toUpperCase() || '·');

  $effect(() => {
    // A new photo URL gets a new chance to load.
    void src;
    failed = false;
  });
</script>

<span
  class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-dark font-semibold text-paper {ring
    ? 'border-2 border-brand'
    : ''} {className}"
  style:width="{size / 16}rem"
  style:height="{size / 16}rem"
  style:font-size="{size / 40}rem"
  aria-hidden="true"
>
  {#if src && !failed}
    <!-- Telegram's CDN gets no Referer, so lobby paths don't leak to it. -->
    <img
      {src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="size-full object-cover"
      onerror={() => (failed = true)}
    />
  {:else}
    {initial}
  {/if}
</span>
