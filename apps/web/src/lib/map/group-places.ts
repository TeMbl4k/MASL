import type { GeoPointDto, LobbyCardDto, MapStationDto } from '@masl/shared';

/** One marker on the lobby map: the lobbies at a station, interchange stations merged. */
export interface MapPlace {
  /** The station hint («м. Белорусская»), unique per place. */
  key: string;
  hint: string;
  /** Line colours of the merged stations, in order of appearance, without repeats. */
  lineColors: string[];
  /** Mean of the station points; station points are public, so this is too. */
  point: GeoPointDto;
  /** By start time. */
  lobbies: LobbyCardDto[];
}

/** GeoJSON properties of a place feature (MapLibre layers read `count` and `key`). */
export interface MapPlaceProperties {
  key: string;
  hint: string;
  count: number;
}

const byStart = (a: LobbyCardDto, b: LobbyCardDto) =>
  a.startsAt === b.startsAt ? a.id.localeCompare(b.id) : a.startsAt.localeCompare(b.startsAt);

/**
 * Map markers from the API's per-station groups. Stations with the same hint (the platforms of
 * an interchange such as Белорусская, a few hundred metres apart) become one marker, so they
 * don't overlap. Places come out in a stable order: by the earliest lobby, then by key.
 */
export function groupPlaces(stations: readonly MapStationDto[]): MapPlace[] {
  const groups = new Map<
    string,
    { hint: string; colors: string[]; points: GeoPointDto[]; lobbies: LobbyCardDto[] }
  >();
  for (const { place, lobbies } of stations) {
    if (lobbies.length === 0) continue;
    let group = groups.get(place.hint);
    if (!group) {
      group = { hint: place.hint, colors: [], points: [], lobbies: [] };
      groups.set(place.hint, group);
    }
    if (place.lineColor && !group.colors.includes(place.lineColor)) group.colors.push(place.lineColor);
    group.points.push(place.point);
    group.lobbies.push(...lobbies);
  }
  const places = [...groups.entries()].map(([key, group]): MapPlace => {
    const lat = group.points.reduce((sum, p) => sum + p.lat, 0) / group.points.length;
    const lng = group.points.reduce((sum, p) => sum + p.lng, 0) / group.points.length;
    return {
      key,
      hint: group.hint,
      lineColors: group.colors,
      point: { lat, lng },
      lobbies: [...group.lobbies].sort(byStart),
    };
  });
  return places.sort((a, b) => byStart(a.lobbies[0], b.lobbies[0]) || a.key.localeCompare(b.key));
}

/** GeoJSON of the map's `places` source (structurally what MapLibre's setData takes). */
export interface MapPlacesGeoJson {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [lng: number, lat: number] };
    properties: MapPlaceProperties;
  }[];
}

/** The places as a GeoJSON FeatureCollection for the map's `places` source. */
export function placesToGeoJson(places: readonly MapPlace[]): MapPlacesGeoJson {
  return {
    type: 'FeatureCollection',
    features: places.map((place) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [place.point.lng, place.point.lat] },
      properties: { key: place.key, hint: place.hint, count: place.lobbies.length },
    })),
  };
}
