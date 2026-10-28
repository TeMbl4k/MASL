<script lang="ts">
  import { pluralForm } from '#lib/format/plural.js';
  import ChevronRight from './icons/ChevronRight.svelte';

  interface Props {
    /** Hosted meetups someone attended. */
    hosted: number;
    /** Meetups the person was marked present at. */
    attended: number;
    companions: number;
    /** The owner's companions list; only on their own profile. */
    companionsHref?: string;
  }

  let { hosted, attended, companions, companionsHref }: Props = $props();

  const COMPANION_FORMS = ['напарник', 'напарника', 'напарников'] as const;
</script>

{#snippet cell(value: number, label: string)}
  <span class="text-2xl font-semibold">{value}</span>
  <span class="text-[0.8125rem] text-gray-light">{label}</span>
{/snippet}

<dl class="grid grid-cols-3 gap-2">
  <div class="flex flex-col items-center gap-0.5 rounded-2xl border border-gray-dark bg-gray-dark/40 py-3">
    <dt class="sr-only">Проведено встреч</dt>
    <dd class="contents">{@render cell(hosted, 'проведено')}</dd>
  </div>
  <div class="flex flex-col items-center gap-0.5 rounded-2xl border border-gray-dark bg-gray-dark/40 py-3">
    <dt class="sr-only">Посещено встреч</dt>
    <dd class="contents">{@render cell(attended, 'посещено')}</dd>
  </div>
  <div class="rounded-2xl border border-gray-dark bg-gray-dark/40">
    <dt class="sr-only">Напарники</dt>
    <dd class="contents">
      {#if companionsHref}
        <a href={companionsHref} class="flex flex-col items-center gap-0.5 py-3">
          <span class="flex items-center gap-0.5 text-2xl font-semibold"
            >{companions}<ChevronRight size={16} class="text-gray-light" /></span
          >
          <span class="text-[0.8125rem] text-gray-light">{pluralForm(companions, COMPANION_FORMS)}</span>
        </a>
      {:else}
        <span class="flex flex-col items-center gap-0.5 py-3">
          {@render cell(companions, pluralForm(companions, COMPANION_FORMS))}
        </span>
      {/if}
    </dd>
  </div>
</dl>
