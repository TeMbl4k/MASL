import { METRO_LINES, MOSCOW_STATIONS, type MetroLine, type MetroStation } from './data.js';

export { METRO_LINES, MOSCOW_STATIONS, type MetroLine, type MetroStation };

export const METRO_ATTRIBUTION = 'Станции: Metro4all (NextGIS), Википедия — CC BY-SA 4.0';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface StationEntry {
  station: MetroStation;
  line: MetroLine;
}

/** Mean Earth radius (IUGG), metres. */
const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres; the server and the wizard use the same formula. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const LINES_BY_ID = new Map(METRO_LINES.map((line) => [line.id, line]));
const STATIONS_BY_ID = new Map(MOSCOW_STATIONS.map((station) => [station.id, station]));
const OPEN_STATIONS = MOSCOW_STATIONS.filter((station) => !station.closed);

function lineOf(station: MetroStation): MetroLine {
  const line = LINES_BY_ID.get(station.lineId);
  if (!line) throw new Error(`Unknown metro line ${station.lineId}`);
  return line;
}

/** Nearest open station; ties → lowest id. Linear scan over ~300 entries. */
export function nearestStation(p: LatLng): StationEntry & { distanceM: number } {
  let best: MetroStation | undefined;
  let bestDistance = Infinity;
  for (const station of OPEN_STATIONS) {
    const d = haversineMeters(p, station);
    if (d < bestDistance || (d === bestDistance && best !== undefined && station.id < best.id)) {
      best = station;
      bestDistance = d;
    }
  }
  if (!best) throw new Error('Metro dataset has no open stations');
  return { station: best, line: lineOf(best), distanceM: bestDistance };
}

/** Any station by id, closed ones included (old lobbies keep their snapshot). */
export function stationById(id: string): StationEntry | null {
  const station = STATIONS_BY_ID.get(id);
  return station ? { station, line: lineOf(station) } : null;
}

/** 'м. Динамо' for kind metro, 'МЦК Лужники' for kind mcc. */
export function placeHint(station: MetroStation, line: MetroLine): string {
  return line.kind === 'mcc' ? `МЦК ${station.name}` : `м. ${station.name}`;
}

/** Case-folded, ё→е, collapsed spaces: the key for search and grouping. */
function searchKey(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

export interface StationGroup {
  name: string;
  entries: StationEntry[];
}

const LINE_ORDER = new Map(METRO_LINES.map((line, i) => [line.id, i]));

/** Open stations grouped by name; groups by name, entries in line order. */
const STATION_GROUPS: readonly (StationGroup & { key: string })[] = (() => {
  const groups = new Map<string, StationGroup & { key: string }>();
  for (const station of OPEN_STATIONS) {
    const key = searchKey(station.name);
    const group = groups.get(key) ?? { key, name: station.name, entries: [] };
    group.entries.push({ station, line: lineOf(station) });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => (LINE_ORDER.get(a.line.id) ?? 0) - (LINE_ORDER.get(b.line.id) ?? 0));
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
})();

/**
 * Station picker search: case-folded, ё→е; same-name stations of different lines form one group.
 * Names that start with the query come first; an empty query returns every group.
 */
export function searchStations(q: string): StationGroup[] {
  const query = searchKey(q);
  const starts: StationGroup[] = [];
  const contains: StationGroup[] = [];
  for (const { key, name, entries } of STATION_GROUPS) {
    const at = key.indexOf(query);
    if (at < 0) continue;
    (at === 0 ? starts : contains).push({ name, entries: [...entries] });
  }
  return [...starts, ...contains];
}
