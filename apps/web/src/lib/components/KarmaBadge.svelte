<script lang="ts">
  import Star from './icons/Star.svelte';

  interface Props {
    karma: number;
    /** `pill`: the header chip; `inline`: next to a name. */
    variant?: 'pill' | 'inline';
    /** Makes the pill a link (the header pill opens the profile). */
    href?: string;
  }

  let { karma, variant = 'inline', href }: Props = $props();
</script>

{#snippet content()}
  <Star size={variant === 'pill' ? 18 : 14} strokeWidth={1.5} class="text-brand" />
  <span>{karma}</span>
{/snippet}

{#if variant === 'pill'}
  <svelte:element
    this={href ? 'a' : 'span'}
    {href}
    aria-label="Карма {karma}"
    class="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-gray-dark/70 px-3 text-[0.9375rem] font-semibold text-paper"
  >
    {@render content()}
  </svelte:element>
{:else}
  <span class="inline-flex items-center gap-1 font-semibold" aria-label="Карма {karma}">
    {@render content()}
  </span>
{/if}
