<script lang="ts">
  import { INTERESTS_MAX, INTERESTS_MIN, type InterestDto } from '@masl/shared';
  import { haptic } from '#lib/tg/haptics.js';

  interface Props {
    interests: InterestDto[];
    /** Chosen slugs; at most INTERESTS_MAX. */
    selected: string[];
    /** Heading above the chips; hidden when the context already names it (a sheet title). */
    heading?: string | null;
  }

  let { interests, selected = $bindable(), heading = 'Интересы' }: Props = $props();

  function toggle(slug: string) {
    if (selected.includes(slug)) {
      selected = selected.filter((s) => s !== slug);
    } else if (selected.length < INTERESTS_MAX) {
      selected = [...selected, slug];
    } else {
      return;
    }
    haptic.select();
  }
</script>

<div class="space-y-3">
  <div class="flex items-baseline justify-between">
    {#if heading}
      <h2 class="text-sm tracking-widest text-gray-light uppercase">{heading}</h2>
    {/if}
    <span class="ml-auto text-sm text-gray-light">{selected.length} из {INTERESTS_MIN}–{INTERESTS_MAX}</span>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each interests as interest (interest.slug)}
      {@const active = selected.includes(interest.slug)}
      <button
        type="button"
        class="min-h-11 rounded-full border px-4 py-2 text-sm transition {active
          ? 'border-brand bg-brand/20 text-paper'
          : 'border-gray-dark bg-gray-dark/40 text-paper/90'}"
        aria-pressed={active}
        disabled={!active && selected.length >= INTERESTS_MAX}
        onclick={() => toggle(interest.slug)}
      >
        {interest.emoji}
        {interest.title}
      </button>
    {/each}
  </div>
</div>
