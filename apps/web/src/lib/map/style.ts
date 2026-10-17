import { MOSCOW_BOUNDS } from '@masl/shared';
import type { LngLatBoundsLike, Map as MapLibreMap, MapOptions, StyleSpecification } from 'maplibre-gl';

/** OpenFreeMap: free vector tiles without a key (ODbL data, attribution stays visible). */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
/** Used if the dark style can't be loaded; darkened by `darkenStyle`. */
export const MAP_STYLE_FALLBACK_URL = 'https://tiles.openfreemap.org/styles/positron';

export const MAP_MIN_ZOOM = 9;
export const MAP_MAX_ZOOM = 17;
/** Zoom of the city view and of a known viewer position. */
export const MAP_CITY_ZOOM = 10;
export const MAP_NEAR_ZOOM = 12;
/** Zoom of the wizard's place picker. */
export const MAP_PLACE_ZOOM = 15;

/** How far the camera may leave MOSCOW_BOUNDS, in degrees. */
const BOUNDS_MARGIN_DEG = 0.2;

export const MAP_MAX_BOUNDS: LngLatBoundsLike = [
  [MOSCOW_BOUNDS.west - BOUNDS_MARGIN_DEG, MOSCOW_BOUNDS.south - BOUNDS_MARGIN_DEG],
  [MOSCOW_BOUNDS.east + BOUNDS_MARGIN_DEG, MOSCOW_BOUNDS.north + BOUNDS_MARGIN_DEG],
];

/** Options shared by every map; the caller adds `container`, `center` and `zoom`. */
export function baseMapOptions(attribution: string[] = []): Omit<MapOptions, 'container'> {
  return {
    style: MAP_STYLE_URL,
    attributionControl: { compact: true, customAttribution: ['OpenFreeMap', ...attribution] },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    maxBounds: MAP_MAX_BOUNDS,
    fadeDuration: 0,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  };
}

// Dark tokens from routes/layout.css; MapLibre paints need literal colours.
const INK = '#000000';
const SURFACE = '#141414';
const WATER = '#0b1a24';
const ROAD = '#333333';
const LABEL = '#a7a7a7';

/** Repaints a light style (positron) in the app's dark palette. */
export function darkenStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const id = layer.id.toLowerCase();
      if (layer.type === 'background') {
        return { ...layer, paint: { ...layer.paint, 'background-color': INK } };
      }
      if (layer.type === 'fill') {
        const color = id.includes('water') ? WATER : SURFACE;
        return { ...layer, paint: { ...layer.paint, 'fill-color': color, 'fill-outline-color': color } };
      }
      if (layer.type === 'line') {
        return { ...layer, paint: { ...layer.paint, 'line-color': id.includes('water') ? WATER : ROAD } };
      }
      if (layer.type === 'symbol') {
        return { ...layer, paint: { ...layer.paint, 'text-color': LABEL, 'text-halo-color': INK } };
      }
      return layer;
    }),
  };
}

/** Switches to the darkened fallback style when the main style fails to load. */
export function attachStyleFallback(map: MapLibreMap): void {
  let switched = false;
  map.on('error', () => {
    if (switched || map.isStyleLoaded()) return;
    switched = true;
    map.setStyle(MAP_STYLE_FALLBACK_URL, { transformStyle: (_previous, next) => darkenStyle(next) });
  });
}
