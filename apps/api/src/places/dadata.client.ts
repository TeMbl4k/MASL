import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  DADATA_DAILY_BUDGET,
  PLACE_SUGGESTIONS_MAX,
  foldForSearch,
  isInMoscowBounds,
  moscowDayKey,
  type GeoPointDto,
  type PlaceSuggestionDto,
} from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { TtlCache } from './ttl-cache.js';

export const DADATA_BASE_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs';

/** The HTTP call to DaData; unit tests inject a fake, so nothing goes out. */
export const DADATA_FETCH = Symbol('DADATA_FETCH');
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

// Technical numbers, not product constants.
const TIMEOUT_MS = 1500;
const CACHE_MAX_ENTRIES = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BREAKER_FAILURES = 5;
const BREAKER_OPEN_MS = 60 * 1000;
const KEY_REJECTED_OPEN_MS = 10 * 60 * 1000;
/** qc_geo 0 = exact coordinates, 1 = nearest house; coarser points are dropped. */
const QC_GEO_MAX = 1;
const REVERSE_RADIUS_M = 100;
const REVERSE_COORD_DECIMALS = 4;
/** Moscow (77) and Moscow Oblast (50). */
const LOCATIONS = [{ kladr_id: '77' }, { kladr_id: '50' }];
const CITY_PREFIX = /^г Москва,\s*/;

/** No key configured, upstream unavailable (error, timeout, breaker, budget), or a value. */
export type DadataResult<T> = { status: 'disabled' } | { status: 'degraded' } | { status: 'ok'; value: T };

const DISABLED = { status: 'disabled' } as const;
const DEGRADED = { status: 'degraded' } as const;

const numberish = z.union([z.string(), z.number()]).nullish();

/** The part of a DaData suggestions response we read; everything else is ignored. */
const upstreamResponse = z.object({
  suggestions: z.array(
    z.object({
      value: z.string(),
      data: z.object({ geo_lat: numberish, geo_lon: numberish, qc_geo: numberish }).nullish(),
    }),
  ),
});
type UpstreamResponse = z.infer<typeof upstreamResponse>;
type UpstreamSuggestion = UpstreamResponse['suggestions'][number];

type Failure =
  { kind: 'timeout' } | { kind: 'network' } | { kind: 'response' } | { kind: 'status'; status: number };

const FAILURE_TEXT = {
  timeout: 'таймаут',
  network: 'сетевая ошибка',
  response: 'некорректный ответ',
} as const;

const toNumber = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? null : Number(value);

const stripCity = (value: string) => value.replace(CITY_PREFIX, '');

/** The suggestion's point, only when it is house-precise and inside Moscow. */
function suggestionPoint(data: UpstreamSuggestion['data']): GeoPointDto | null {
  const lat = toNumber(data?.geo_lat);
  const lng = toNumber(data?.geo_lon);
  const qc = toNumber(data?.qc_geo);
  if (lat === null || lng === null || qc === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(qc <= QC_GEO_MAX)) return null;
  const point = { lat, lng };
  return isInMoscowBounds(point) ? point : null;
}

const roundCoord = (value: number) => Number(value.toFixed(REVERSE_COORD_DECIMALS));

/**
 * DaData address suggestions and reverse geocoding. Works only with DADATA_API_KEY; without it
 * every call answers `disabled` and nothing goes out. One request per call, no retries; a
 * TTL cache, a circuit breaker and a daily budget keep the free plan safe. Never logs the key,
 * the query, coordinates or upstream bodies.
 */
@Injectable()
export class DadataClient {
  readonly #apiKey: string | undefined;
  readonly #suggestCache = new TtlCache<PlaceSuggestionDto[]>(CACHE_MAX_ENTRIES, CACHE_TTL_MS);
  readonly #reverseCache = new TtlCache<string | null>(CACHE_MAX_ENTRIES, CACHE_TTL_MS);
  readonly #log = new Logger('DaData');
  #failures = 0;
  #openUntil = 0;
  #keyRejectedLogged = false;
  #budget = { day: '', used: 0, exhaustedLogged: false };

  constructor(
    @Inject(ENV) env: Pick<Env, 'DADATA_API_KEY'>,
    @Inject(DADATA_FETCH) private readonly fetchFn: FetchFn,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.#apiKey = env.DADATA_API_KEY;
  }

  get enabled(): boolean {
    return this.#apiKey !== undefined;
  }

  /** Up to PLACE_SUGGESTIONS_MAX addresses in Moscow and the oblast, «г Москва, » stripped. */
  async suggest(query: string): Promise<DadataResult<PlaceSuggestionDto[]>> {
    if (!this.#apiKey) return DISABLED;
    const cacheKey = foldForSearch(query);
    const cached = this.#suggestCache.get(cacheKey, this.clock.now().getTime());
    if (cached !== undefined) return { status: 'ok', value: cached };

    const response = await this.#post('suggest/address', {
      query,
      count: PLACE_SUGGESTIONS_MAX,
      locations: LOCATIONS,
      language: 'ru',
    });
    if (!response) return DEGRADED;
    const value = response.suggestions.slice(0, PLACE_SUGGESTIONS_MAX).map((s) => ({
      value: stripCity(s.value),
      point: suggestionPoint(s.data),
    }));
    this.#suggestCache.set(cacheKey, value, this.clock.now().getTime());
    return { status: 'ok', value };
  }

  /** The address at a point (within 100 m), or null when DaData knows none. */
  async reverse(point: GeoPointDto): Promise<DadataResult<string | null>> {
    if (!this.#apiKey) return DISABLED;
    // Rounded to about 10 m, so the request and the cache key are the same point.
    const lat = roundCoord(point.lat);
    const lon = roundCoord(point.lng);
    const cacheKey = `${lat},${lon}`;
    const cached = this.#reverseCache.get(cacheKey, this.clock.now().getTime());
    if (cached !== undefined) return { status: 'ok', value: cached };

    const response = await this.#post('geolocate/address', {
      lat,
      lon,
      count: 1,
      radius_meters: REVERSE_RADIUS_M,
    });
    if (!response) return DEGRADED;
    const first = response.suggestions[0];
    const value = first ? stripCity(first.value) : null;
    this.#reverseCache.set(cacheKey, value, this.clock.now().getTime());
    return { status: 'ok', value };
  }

  /** One upstream call; null when the breaker is open, the budget is spent or the call failed. */
  async #post(path: string, body: object): Promise<UpstreamResponse | null> {
    if (this.clock.now().getTime() < this.#openUntil || !this.#takeBudget()) {
      return null;
    }
    const controller = new AbortController();
    // The timer also covers reading the body, not only the headers.
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetchFn(`${DADATA_BASE_URL}/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${this.#apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        return this.#fail(controller.signal.aborted ? { kind: 'timeout' } : { kind: 'network' });
      }
      if (!response.ok) {
        return this.#fail({ kind: 'status', status: response.status });
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return this.#fail(controller.signal.aborted ? { kind: 'timeout' } : { kind: 'response' });
      }
      const parsed = upstreamResponse.safeParse(json);
      if (!parsed.success) {
        return this.#fail({ kind: 'response' });
      }
      this.#failures = 0;
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Counts one outbound call against today's (Moscow day) budget. */
  #takeBudget(): boolean {
    const day = moscowDayKey(this.clock.now());
    if (this.#budget.day !== day) {
      this.#budget = { day, used: 0, exhaustedLogged: false };
    }
    if (this.#budget.used >= DADATA_DAILY_BUDGET) {
      if (!this.#budget.exhaustedLogged) {
        this.#budget.exhaustedLogged = true;
        this.#log.warn(
          `Дневной лимит запросов к DaData (${DADATA_DAILY_BUDGET}) исчерпан: подсказки адресов вернутся завтра`,
        );
      }
      return false;
    }
    this.#budget.used += 1;
    return true;
  }

  /** Updates the breaker after a failed call; always null, for `return this.#fail(...)`. */
  #fail(failure: Failure): null {
    const now = this.clock.now().getTime();
    if (failure.kind === 'status' && (failure.status === 401 || failure.status === 403)) {
      this.#open(now, KEY_REJECTED_OPEN_MS);
      if (!this.#keyRejectedLogged) {
        this.#keyRejectedLogged = true;
        this.#log.error('DaData отклонил ключ: проверьте DADATA_API_KEY');
      }
      return null;
    }
    if (failure.kind === 'status' && failure.status === 429) {
      this.#open(now, BREAKER_OPEN_MS);
      this.#log.warn('DaData ограничил частоту запросов: подсказки адресов приостановлены на минуту');
      return null;
    }
    this.#failures += 1;
    if (this.#failures >= BREAKER_FAILURES) {
      this.#open(now, BREAKER_OPEN_MS);
      const reason = failure.kind === 'status' ? `HTTP ${failure.status}` : FAILURE_TEXT[failure.kind];
      this.#log.warn(
        `DaData не отвечает (${BREAKER_FAILURES} ошибок подряд, последняя: ${reason}): подсказки адресов приостановлены на минуту`,
      );
    }
    return null;
  }

  #open(now: number, forMs: number): void {
    this.#openUntil = now + forMs;
    this.#failures = 0;
  }
}
