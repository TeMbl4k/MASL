<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { isInMoscowBounds, type GeoPointDto } from '@masl/shared';
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import { onMount } from 'svelte';
  import Locate from '#lib/components/icons/Locate.svelte';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { requestUserLocation } from '#lib/tg/location.js';
  import { loadMaplibre } from './maplibre.js';
  import { attachStyleFallback, baseMapOptions, foldAttribution, MAP_PLACE_ZOOM } from './style.js';

  interface Props {
    /** The pin; null until the host moves the map, picks a suggestion or locates. */
    point: GeoPointDto | null;
    /** Where the map opens when there is no pin yet. */
    initialCenter: GeoPointDto;
    /** The map stopped at a new centre: the pin moved there. */
    onmove: (point: GeoPointDto) => void;
    /** MapLibre could not start (no WebGL, chunk failed): the step switches to the station list. */
    onfail: () => void;
  }

  let { point, initialCenter, onmove, onfail }: Props = $props();

  /** The pin's precision: about 10 cm, more than enough for «где встречаемся». */
  const PIN_DECIMALS = 6;

  let container = $state<HTMLDivElement | null>(null);
  let map: MapLibreMap | null = null;
  let locating = $state(false);

  const round = (value: number) => Number(value.toFixed(PIN_DECIMALS));

  /**
   * Moves the map (and so the pin) to a point: a picked address suggestion or the viewer's location.
   * Instant, not animated: it stops a gesture still gliding, whose late `moveend` would otherwise
   * move the pin back.
   */
  export function jumpTo(target: GeoPointDto): void {
    map?.jumpTo({ center: [target.lng, target.lat], zoom: MAP_PLACE_ZOOM });
  }

  onMount(() => {
    let cancelled = false;
    loadMaplibre()
      .then((maplibre) => {
        if (cancelled || !container) return;
        // Read now, not at mount: a suggestion picked while the chunk loaded has moved the pin.
        const start = point ?? initialCenter;
        const instance = new maplibre.Map({
          ...baseMapOptions(),
          container,
          center: [start.lng, start.lat],
          zoom: MAP_PLACE_ZOOM,
        });
        attachStyleFallback(instance);
        foldAttribution(instance);
        instance.on('moveend', () => {
          const center = instance.getCenter();
          onmove({ lat: round(center.lat), lng: round(center.lng) });
        });
        map = instance;
      })
      .catch(() => {
        // No WebGL2 or the chunk failed to load.
        if (!cancelled) onfail();
      });
    return () => {
      cancelled = true;
      map?.remove();
      map = null;
    };
  });

  async function locate() {
    haptic.tap();
    locating = true;
    try {
      const result = await requestUserLocation();
      if (result.kind === 'ok') {
        if (isInMoscowBounds(result)) jumpTo(result);
        else toast.show('Вы сейчас не в Москве — сдвиньте карту к месту встречи');
      } else if (result.kind === 'denied') {
        toast.show('Доступ к геолокации выключен — сдвиньте карту к месту встречи');
      } else {
        toast.show('Геолокация недоступна на этом устройстве');
      }
    } finally {
      locating = false;
    }
  }
</script>

<div class="relative h-60 overflow-hidden rounded-2xl border border-gray-dark bg-ink">
  <!-- MapLibre's stylesheet makes the container `position: relative`, so it also gets an explicit size. -->
  <div
    bind:this={container}
    class="absolute inset-0 size-full"
    role="region"
    aria-label="Карта: сдвиньте её, чтобы поставить точку встречи"
  ></div>
  <!-- The pin stays in the centre; its tip marks the point. -->
  <svg
    width="34"
    height="44"
    viewBox="0 0 24 31"
    aria-hidden="true"
    class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full transition-opacity {point
      ? 'opacity-100'
      : 'opacity-60'}"
  >
    <path
      d="M12 30s-10-9-10-17A10 10 0 0 1 22 13c0 8-10 17-10 17z"
      fill="var(--color-brand)"
      stroke="var(--color-ink)"
      stroke-width="1.5"
    />
    <circle cx="12" cy="12.5" r="3.5" fill="var(--color-ink)" />
  </svg>
  {#if !point}
    <p
      class="pointer-events-none absolute inset-x-3 top-3 rounded-xl bg-ink/85 px-3 py-2 text-center text-[0.8125rem] text-paper"
    >
      Сдвиньте карту, чтобы поставить точку
    </p>
  {/if}
  <button
    type="button"
    aria-label="Моё местоположение"
    aria-busy={locating}
    disabled={locating}
    class="absolute right-2.5 bottom-9 flex size-11 items-center justify-center rounded-full border border-gray-dark bg-ink/90 text-paper {locating
      ? 'animate-pulse'
      : ''}"
    onclick={locate}
  >
    <Locate size={20} />
  </button>
</div>
