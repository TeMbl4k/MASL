<script lang="ts">
  import type { StationEntry } from '@masl/shared/metro';
  import type { Component } from 'svelte';
  import { page } from '$app/state';
  import { origin } from '#lib/stores/origin.svelte.js';
  import { closeSheet, openSheet, switchSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { openLocationSettings, type LocationResult } from '#lib/tg/location.js';
  import Globe from './icons/Globe.svelte';
  import type { IconProps } from './icons/Icon.svelte';
  import Locate from './icons/Locate.svelte';
  import Metro from './icons/Metro.svelte';
  import Sheet from './Sheet.svelte';
  import StationPicker from './StationPicker.svelte';

  /** The last failed geolocation attempt, explained in the sheet. */
  let failure = $state<Exclude<LocationResult, { kind: 'ok' }> | null>(null);

  /**
   * Asks for the viewer's location (the sheet's row or the feed banner). A refusal opens the
   * sheet with what to do next.
   */
  export async function locate(): Promise<void> {
    failure = null;
    const result = await origin.locate();
    if (result.kind === 'ok') {
      closeSheet();
      return;
    }
    failure = result;
    if (page.state.sheet !== 'origin') await openSheet('origin');
  }

  /** Opens the station picker, over the origin sheet or on its own. */
  export function pickStation(): Promise<void> {
    return switchSheet('station');
  }

  function wholeCity() {
    haptic.select();
    origin.useWholeCity();
    closeSheet();
  }

  async function picked(entry: StationEntry) {
    await origin.pickStation(entry);
    closeSheet();
  }
</script>

{#snippet option(Icon: Component<IconProps>, text: string, onclick: () => void, busy = false)}
  <button
    type="button"
    class="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-gray-dark/50 px-4 text-left text-base disabled:opacity-60"
    disabled={busy}
    aria-busy={busy}
    {onclick}
  >
    <Icon size={20} class="text-brand" />
    <span class="flex-1">{text}</span>
  </button>
{/snippet}

<Sheet name="origin" title="Откуда считать расстояние">
  <div class="flex flex-col gap-2">
    {@render option(
      Locate,
      origin.locating ? 'Определяем…' : 'Определить по геолокации',
      () => void locate(),
      origin.locating,
    )}
    {#if failure?.kind === 'denied'}
      <div
        class="flex flex-col gap-3 rounded-2xl border border-gray-dark p-4 text-sm text-gray-light"
        role="alert"
      >
        <p>Доступ к геолокации выключен. Включите его в настройках или выберите станцию метро.</p>
        <div class="flex flex-wrap gap-2">
          {#if failure.settings}
            <button
              type="button"
              class="min-h-11 rounded-xl bg-gray-dark px-4 text-paper"
              onclick={openLocationSettings}
            >
              Открыть настройки
            </button>
          {/if}
          <button
            type="button"
            class="min-h-11 rounded-xl bg-gray-dark px-4 text-paper"
            onclick={pickStation}
          >
            Выбрать метро
          </button>
        </div>
      </div>
    {:else if failure?.kind === 'unavailable'}
      <p class="rounded-2xl border border-gray-dark p-4 text-sm text-gray-light" role="alert">
        Геолокация недоступна на этом устройстве
      </p>
    {/if}
    {@render option(Metro, 'Выбрать станцию метро', () => void pickStation())}
    {@render option(Globe, 'Вся Москва', wholeCity)}
  </div>
  <p class="mt-4 text-xs text-gray-light">
    Координаты нужны только для сортировки по расстоянию. Мы их не храним.
  </p>
</Sheet>

<Sheet name="station" title="Станция метро">
  <StationPicker onpick={(entry) => void picked(entry)} autofocus />
</Sheet>
