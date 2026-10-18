<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import type { GeoPointDto } from '@masl/shared';
  import { METRO_ATTRIBUTION } from '@masl/shared/metro';
  import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { TG_BRAND, TG_INK, TG_PAPER } from '#lib/tg/colors.js';
  import { placesToGeoJson, type MapPlace } from './group-places.js';
  import { loadMaplibre } from './maplibre.js';
  import MapPlaceholder from './MapPlaceholder.svelte';
  import { attachStyleFallback, baseMapOptions, foldAttribution } from './style.js';

  interface Props {
    places: MapPlace[];
    /** The viewer's point, drawn as a dot; it stays in the browser. */
    user: GeoPointDto | null;
    center: GeoPointDto;
    zoom: number;
    /** A place marker was tapped. */
    onselect: (key: string) => void;
    /** MapLibre or both map styles failed to load: the page shows the list instead. */
    onfail: () => void;
  }

  let { places, user, center, zoom, onselect, onfail }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let map = $state<MapLibreMap | null>(null);
  /** The current style has our sources and layers (they are lost when the style is replaced). */
  let layersReady = $state(false);

  const EASE_MS = 300;
  const EMPTY = { type: 'FeatureCollection' as const, features: [] };

  function userGeoJson(point: GeoPointDto | null) {
    return {
      type: 'FeatureCollection' as const,
      features: point
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
              properties: {},
            },
          ]
        : [],
    };
  }

  function addLayers(m: MapLibreMap) {
    m.addSource('places', { type: 'geojson', data: EMPTY });
    m.addSource('user', { type: 'geojson', data: EMPTY });
    m.addLayer({
      id: 'places-hit',
      type: 'circle',
      source: 'places',
      paint: { 'circle-radius': 24, 'circle-opacity': 0 },
    });
    m.addLayer({
      id: 'places-halo',
      type: 'circle',
      source: 'places',
      paint: { 'circle-radius': 18, 'circle-color': TG_BRAND, 'circle-opacity': 0.25 },
    });
    m.addLayer({
      id: 'places-dot',
      type: 'circle',
      source: 'places',
      paint: {
        'circle-radius': 12,
        'circle-color': TG_BRAND,
        'circle-stroke-width': 2,
        'circle-stroke-color': TG_INK,
      },
    });
    m.addLayer({
      id: 'places-count',
      type: 'symbol',
      source: 'places',
      layout: {
        'text-field': ['to-string', ['get', 'count']],
        'text-font': ['Noto Sans Bold'],
        'text-size': 13,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': TG_INK },
    });
    m.addLayer({
      id: 'user',
      type: 'circle',
      source: 'user',
      paint: {
        'circle-radius': 7,
        'circle-color': TG_PAPER,
        'circle-stroke-width': 3,
        'circle-stroke-color': TG_BRAND,
      },
    });
    layersReady = true;
  }

  /** Moves the camera to a point (the «Где я» button). */
  export function focus(point: GeoPointDto, toZoom = zoom) {
    const camera = {
      center: [point.lng, point.lat] as [number, number],
      zoom: Math.max(map?.getZoom() ?? 0, toZoom),
    };
    if (prefersReducedMotion.current) map?.jumpTo(camera);
    else map?.easeTo({ ...camera, duration: EASE_MS });
  }

  onMount(() => {
    let disposed = false;
    let instance: MapLibreMap | null = null;
    loadMaplibre().then(
      (maplibre) => {
        if (disposed || !container) return;
        instance = new maplibre.Map({
          ...baseMapOptions([METRO_ATTRIBUTION]),
          container,
          center: [center.lng, center.lat],
          zoom,
        });
        attachStyleFallback(instance, onfail);
        foldAttribution(instance);
        instance.on('style.load', () => {
          layersReady = false;
          if (instance) addLayers(instance);
        });
        instance.on('click', 'places-hit', (event) => {
          const key: unknown = event.features?.[0]?.properties?.key;
          if (typeof key === 'string') onselect(key);
        });
        instance.on('mouseenter', 'places-hit', () => {
          if (instance) instance.getCanvas().style.cursor = 'pointer';
        });
        instance.on('mouseleave', 'places-hit', () => {
          if (instance) instance.getCanvas().style.cursor = '';
        });
        map = instance;
      },
      () => {
        if (!disposed) onfail();
      },
    );
    return () => {
      disposed = true;
      instance?.remove();
      map = null;
    };
  });

  $effect(() => {
    if (!map || !layersReady) return;
    void map.getSource<GeoJSONSource>('places')?.setData(placesToGeoJson(places));
  });

  $effect(() => {
    if (!map || !layersReady) return;
    void map.getSource<GeoJSONSource>('user')?.setData(userGeoJson(user));
  });
</script>

<!-- The canvas is decorative for screen readers: the place sheet and the list carry the content. -->
<div class="absolute inset-0 bg-ink" aria-hidden="true">
  <!-- MapLibre makes its container position: relative, so it gets a wrapper to fill. -->
  <div bind:this={container} class="size-full"></div>
</div>
{#if !layersReady}
  <MapPlaceholder />
{/if}
