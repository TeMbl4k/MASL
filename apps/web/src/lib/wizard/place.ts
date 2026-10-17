import type { GeoPointDto } from '@masl/shared';

/**
 * The point without a map (no WebGL2, spec §9.7): the picked address suggestion's point when
 * there is one, otherwise the picked station's coordinates, whatever order they were picked in.
 */
export function fallbackPoint(
  suggestion: GeoPointDto | null,
  station: { lat: number; lng: number } | null,
): GeoPointDto | null {
  if (suggestion) return suggestion;
  return station ? { lat: station.lat, lng: station.lng } : null;
}
