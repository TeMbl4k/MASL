<script lang="ts">
  import type { ExactPlaceDto, PublicPlaceDto } from '@masl/shared';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { copyText, openInMaps } from '#lib/tg/links.js';
  import Copy from './icons/Copy.svelte';
  import External from './icons/External.svelte';

  interface Props {
    /** Only from a detail with `access` member or host. */
    exactPlace: ExactPlaceDto;
    place: PublicPlaceDto;
  }

  let { exactPlace, place }: Props = $props();

  async function copy() {
    const copied = await copyText(exactPlace.address);
    toast.show(copied ? 'Адрес скопирован' : 'Не удалось скопировать адрес', copied ? 'success' : 'error');
  }
</script>

<!-- The exact address: the host and approved members only (the API sends it to nobody else). -->
<section
  aria-labelledby="exact-place-title"
  class="flex flex-col gap-3 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 p-4"
>
  <h2 id="exact-place-title" class="text-xs tracking-widest text-gray-light uppercase">Точный адрес</h2>
  <p class="text-base leading-snug break-words">{exactPlace.address}</p>
  <p class="flex items-center gap-1.5 text-sm text-gray-light">
    {#if place.lineColor}
      <span class="size-2.5 shrink-0 rounded-full" style:background-color={place.lineColor} aria-hidden="true"
      ></span>
    {/if}
    {place.hint}
  </p>
  <div class="grid grid-cols-2 gap-2">
    <button
      type="button"
      aria-label="Открыть в Яндекс Картах"
      class="flex min-h-11 items-center justify-center gap-1.5 rounded-[0.875rem] bg-gray-dark px-2 text-sm font-medium"
      onclick={() => openInMaps(exactPlace.point)}
    >
      <External size={16} />
      Яндекс Карты
    </button>
    <button
      type="button"
      aria-label="Скопировать адрес"
      class="flex min-h-11 items-center justify-center gap-1.5 rounded-[0.875rem] bg-gray-dark px-2 text-sm font-medium"
      onclick={() => void copy()}
    >
      <Copy size={16} />
      Скопировать
    </button>
  </div>
</section>
