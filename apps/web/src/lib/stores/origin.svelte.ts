import { isInMoscowBounds, roundViewerCoord, type GeoPointDto } from '@masl/shared';
import type { placeHint, StationEntry } from '@masl/shared/metro';
import { storage } from '../storage.js';
import { requestUserLocation, type LocationResult } from '../tg/location.js';
import { clock } from './clock.svelte.js';

/** Where the feed measures distances from. Coordinates are rounded and never stored. */
export type ViewerOrigin =
  | { kind: 'geo'; lat: number; lng: number; at: number }
  /** `hint` is «м. Динамо» / «МЦК Лужники». */
  | { kind: 'station'; id: string; hint: string; lat: number; lng: number }
  | { kind: 'city' };

/** A geolocation fix is kept in memory this long, then the viewer is asked again. */
const GEO_TTL_MS = 15 * 60_000;
const RECENT_STATIONS_MAX = 3;
const STATION_KEY = 'masl:origin-station:v1';
const RECENT_KEY = 'masl:recent-stations:v1';

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(storage.get(RECENT_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, RECENT_STATIONS_MAX)
      : [];
  } catch {
    return [];
  }
}

type PlaceHint = typeof placeHint;

const rounded = (lat: number, lng: number) => ({ lat: roundViewerCoord(lat), lng: roundViewerCoord(lng) });

class OriginStore {
  #value = $state<ViewerOrigin | null>(null);
  /** The last geolocation was outside Moscow, so the whole city is shown. */
  outsideMoscow = $state(false);
  locating = $state(false);
  /** Station ids picked lately, newest first (StationPicker's «Недавние»). */
  recentIds = $state<string[]>(readRecent());
  #restored = false;

  /** The origin, or null when none was chosen or the geolocation fix is too old. */
  get current(): ViewerOrigin | null {
    const value = this.#value;
    if (value?.kind === 'geo' && clock.now - value.at > GEO_TTL_MS) return null;
    return value;
  }

  /** The point sent to the API (`lat`/`lng`), already rounded; null for the whole city. */
  get point(): GeoPointDto | null {
    const value = this.current;
    return value && value.kind !== 'city' ? { lat: value.lat, lng: value.lng } : null;
  }

  /** Chip label: «Рядом с вами», «м. Динамо», «Вся Москва»; null without an origin. */
  get label(): string | null {
    const value = this.current;
    if (!value) return null;
    if (value.kind === 'geo') return 'Рядом с вами';
    if (value.kind === 'station') return value.hint;
    return 'Вся Москва';
  }

  /** Restores the saved station once per app start (the metro data loads lazily). */
  async restore(): Promise<void> {
    if (this.#restored) return;
    this.#restored = true;
    const id = storage.get(STATION_KEY);
    if (!id || this.#value) return;
    const { stationById, placeHint } = await import('@masl/shared/metro');
    const entry = stationById(id);
    if (entry && !entry.station.closed && !this.#value) this.#setStation(entry, placeHint);
  }

  /** Asks for the viewer's location; outside Moscow it falls back to the whole city. */
  async locate(): Promise<LocationResult> {
    this.locating = true;
    try {
      const result = await requestUserLocation();
      if (result.kind === 'ok') {
        const inMoscow = isInMoscowBounds(result);
        this.outsideMoscow = !inMoscow;
        this.#value = inMoscow
          ? { kind: 'geo', ...rounded(result.lat, result.lng), at: Date.now() }
          : { kind: 'city' };
      }
      return result;
    } finally {
      this.locating = false;
    }
  }

  /** Picks a station from StationPicker (the metro module is loaded by then). */
  async pickStation(entry: StationEntry): Promise<void> {
    const { placeHint } = await import('@masl/shared/metro');
    this.#setStation(entry, placeHint);
    this.outsideMoscow = false;
    storage.set(STATION_KEY, entry.station.id);
    this.rememberStation(entry.station.id);
  }

  /** Adds a station to «Недавние» (also used by the wizard's station fallback). */
  rememberStation(id: string): void {
    this.recentIds = [id, ...this.recentIds.filter((r) => r !== id)].slice(0, RECENT_STATIONS_MAX);
    storage.set(RECENT_KEY, JSON.stringify(this.recentIds));
  }

  useWholeCity(): void {
    this.#value = { kind: 'city' };
    storage.remove(STATION_KEY);
  }

  #setStation({ station, line }: StationEntry, placeHint: PlaceHint): void {
    this.#value = {
      kind: 'station',
      id: station.id,
      hint: placeHint(station, line),
      ...rounded(station.lat, station.lng),
    };
  }
}

/** The viewer's origin for distances in the feed and on the lobby page. */
export const origin = new OriginStore();
