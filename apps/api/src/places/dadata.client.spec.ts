import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { DADATA_DAILY_BUDGET, PLACE_SUGGESTIONS_MAX } from '@masl/shared';
import { DADATA_BASE_URL, DadataClient, type FetchFn } from './dadata.client.js';

const KEY = 'test-dadata-key-0f3a9c';
const USER = 'b3f1c2d4-0000-4000-8000-000000000001';
const QUERY = 'Тверская 1';
const POINT = { lat: 55.757_812_3, lng: 37.611_234_5 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const suggestion = (value: string, data: Record<string, unknown> | null = {}) => ({
  value,
  unrestricted_value: `101000, ${value}`,
  data,
});

const house = (value: string, lat = '55.7578', lng = '37.6112', qc = '0') =>
  suggestion(value, { geo_lat: lat, geo_lon: lng, qc_geo: qc, kladr_id: '7700000000000' });

function setup(options: { key?: string | undefined; respond?: FetchFn } = {}) {
  let nowMs = Date.parse('2026-10-17T12:00:00Z');
  const fetchFn = vi.fn<FetchFn>(
    options.respond ?? (async () => json({ suggestions: [house('г Москва, ул Тверская, д 1')] })),
  );
  const key = 'key' in options ? options.key : KEY;
  const client = new DadataClient({ DADATA_API_KEY: key }, fetchFn, { now: () => new Date(nowMs) });
  return {
    client,
    fetchFn,
    advance: (ms: number) => {
      nowMs += ms;
    },
    requestBody: (call = 0) =>
      JSON.parse(String(fetchFn.mock.calls[call]![1].body)) as Record<string, unknown>,
  };
}

const failWith =
  (status: number): FetchFn =>
  async () =>
    json({ message: 'upstream says no' }, status);

describe('DadataClient', () => {
  let logs: ReturnType<typeof vi.spyOn>[];
  const logged = () => inspect(logs.map((spy) => spy.mock.calls));

  beforeEach(() => {
    logs = (['log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is disabled without a key and never calls upstream', async () => {
    const { client, fetchFn } = setup({ key: undefined });
    expect(client.enabled).toBe(false);
    expect(await client.suggest(USER, QUERY)).toEqual({ status: 'disabled' });
    expect(await client.reverse(USER, POINT)).toEqual({ status: 'disabled' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('posts the suggest request with the key only in the Authorization header', async () => {
    const { client, fetchFn, requestBody } = setup();
    expect(client.enabled).toBe(true);
    await client.suggest(USER, QUERY);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${DADATA_BASE_URL}/suggest/address`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Token ${KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(requestBody()).toEqual({
      query: QUERY,
      count: PLACE_SUGGESTIONS_MAX,
      locations: [{ kladr_id: '77' }, { kladr_id: '50' }],
      language: 'ru',
    });
    expect(url).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
  });

  it('maps suggestions: strips «г Москва, », keeps only house-precise points inside Moscow', async () => {
    const { client } = setup({
      respond: async () =>
        json({
          suggestions: [
            house('г Москва, ул Тверская, д 1'),
            house('г Москва, ул Тверская, д 3', '55.7581', '37.6105', '1'),
            house('г Москва, ул Тверская', '55.7600', '37.6100', '2'),
            // Precise, but in St Petersburg.
            house('г Санкт-Петербург, Невский пр-кт, д 1', '59.9358', '30.3260', '0'),
            // Precise, latitude inside the bounds, longitude just east of them.
            house('Московская обл, г Старая Купавна, ул Ленина, д 1', '55.8069', '38.1786', '0'),
            // Beyond PLACE_SUGGESTIONS_MAX.
            house('г Москва, ул Тверская, д 7'),
          ],
        }),
    });
    const result = await client.suggest(USER, QUERY);
    expect(result).toEqual({
      status: 'ok',
      value: [
        { value: 'ул Тверская, д 1', point: { lat: 55.7578, lng: 37.6112 } },
        { value: 'ул Тверская, д 3', point: { lat: 55.7581, lng: 37.6105 } },
        { value: 'ул Тверская', point: null },
        { value: 'г Санкт-Петербург, Невский пр-кт, д 1', point: null },
        { value: 'Московская обл, г Старая Купавна, ул Ленина, д 1', point: null },
      ],
    });
  });

  it('drops points with missing coordinates, qc_geo or data', async () => {
    const { client } = setup({
      respond: async () =>
        json({
          suggestions: [
            suggestion('г Москва, ул Тверская, д 5', { geo_lat: null, geo_lon: null, qc_geo: null }),
            suggestion('г Москва, ул Тверская, д 9', { geo_lat: '55.7578', geo_lon: '37.6112' }),
            suggestion('г Москва, ул Тверская, д 11', { geo_lat: '', geo_lon: '37.6112', qc_geo: '0' }),
            suggestion('Московская обл, г Химки, ул Тверская', null),
          ],
        }),
    });
    expect(await client.suggest(USER, QUERY)).toEqual({
      status: 'ok',
      value: [
        { value: 'ул Тверская, д 5', point: null },
        { value: 'ул Тверская, д 9', point: null },
        { value: 'ул Тверская, д 11', point: null },
        { value: 'Московская обл, г Химки, ул Тверская', point: null },
      ],
    });
  });

  it('accepts numeric coordinates and qc_geo', async () => {
    const { client } = setup({
      respond: async () =>
        json({
          suggestions: [suggestion('г Москва, ул Арбат, д 1', { geo_lat: 55.75, geo_lon: 37.6, qc_geo: 0 })],
        }),
    });
    expect(await client.suggest(USER, QUERY)).toEqual({
      status: 'ok',
      value: [{ value: 'ул Арбат, д 1', point: { lat: 55.75, lng: 37.6 } }],
    });
  });

  it('reverse-geocodes a point rounded to 4 decimals within 100 m', async () => {
    const { client, fetchFn, requestBody } = setup();
    expect(await client.reverse(USER, POINT)).toEqual({ status: 'ok', value: 'ул Тверская, д 1' });
    expect(fetchFn.mock.calls[0]![0]).toBe(`${DADATA_BASE_URL}/geolocate/address`);
    expect(requestBody()).toEqual({ lat: 55.7578, lon: 37.6112, count: 1, radius_meters: 100 });
  });

  it('reverse gives null when DaData knows no address there', async () => {
    const { client } = setup({ respond: async () => json({ suggestions: [] }) });
    expect(await client.reverse(USER, POINT)).toEqual({ status: 'ok', value: null });
  });

  it('serves repeats from the cache: case, spaces and ё fold together; entries live 24 h', async () => {
    const { client, fetchFn, advance } = setup();
    const first = await client.suggest(USER, 'Семёновская 1');
    expect(await client.suggest(USER, '  семеновская   1 ')).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    advance(24 * 3600_000);
    await client.suggest(USER, 'Семёновская 1');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('caches reverse results per ~10 m cell, empty results included', async () => {
    const { client, fetchFn } = setup({ respond: async () => json({ suggestions: [] }) });
    await client.reverse(USER, POINT);
    await client.reverse(USER, { lat: POINT.lat + 0.000_01, lng: POINT.lng - 0.000_01 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await client.reverse(USER, { lat: POINT.lat + 0.001, lng: POINT.lng });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps cache entries per user, so one user never learns what another searched', async () => {
    const { client, fetchFn } = setup();
    const other = 'b3f1c2d4-0000-4000-8000-000000000002';
    await client.suggest(USER, QUERY);
    await client.reverse(USER, POINT);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await client.suggest(other, QUERY);
    await client.reverse(other, POINT);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('does not cache failures', async () => {
    let fail = true;
    const { client, fetchFn } = setup({
      respond: async () => (fail ? json({}, 500) : json({ suggestions: [] })),
    });
    expect(await client.suggest(USER, QUERY)).toEqual({ status: 'degraded' });
    fail = false;
    expect(await client.suggest(USER, QUERY)).toEqual({ status: 'ok', value: [] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('times out after 1.5 s and answers degraded', async () => {
    vi.useFakeTimers();
    const { client } = setup({
      respond: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    let settled = false;
    const pending = client.suggest(USER, QUERY).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ status: 'degraded' });
  });

  it.each([
    ['a network error', (async () => Promise.reject(new TypeError('fetch failed'))) as FetchFn],
    ['a 500', failWith(500)],
    ['a body that is not JSON', (async () => new Response('<html>', { status: 200 })) as FetchFn],
    ['an unexpected shape', (async () => json({ results: [] })) as FetchFn],
  ])('answers degraded on %s', async (_name, respond) => {
    const { client } = setup({ respond });
    expect(await client.suggest(USER, QUERY)).toEqual({ status: 'degraded' });
    expect(await client.reverse(USER, POINT)).toEqual({ status: 'degraded' });
  });

  it('opens the breaker for 60 s after 5 failures in a row', async () => {
    const { client, fetchFn, advance } = setup({ respond: failWith(502) });
    for (let i = 0; i < 5; i++) {
      expect(await client.suggest(USER, `${QUERY} ${i}`)).toEqual({ status: 'degraded' });
    }
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(await client.suggest(USER, 'Арбат 1')).toEqual({ status: 'degraded' });
    expect(await client.reverse(USER, POINT)).toEqual({ status: 'degraded' });
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(logged()).toContain('DaData не отвечает');

    advance(59_999);
    await client.suggest(USER, 'Арбат 1');
    expect(fetchFn).toHaveBeenCalledTimes(5);
    advance(1);
    await client.suggest(USER, 'Арбат 1');
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  it('a success resets the failure count', async () => {
    let calls = 0;
    const { client, fetchFn } = setup({
      respond: async () => (++calls === 5 ? json({ suggestions: [] }) : json({}, 500)),
    });
    for (let i = 0; i < 9; i++) await client.suggest(USER, `${QUERY} ${i}`);
    // Failures 1–4, a success, failures 1–4 again: the breaker never opened.
    expect(fetchFn).toHaveBeenCalledTimes(9);
  });

  it.each([401, 403])('opens the breaker for 10 min on %i and logs the rejected key once', async (status) => {
    const { client, fetchFn, advance } = setup({ respond: failWith(status) });
    expect(await client.suggest(USER, QUERY)).toEqual({ status: 'degraded' });
    advance(9 * 60_000);
    expect(await client.suggest(USER, QUERY)).toEqual({ status: 'degraded' });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    advance(60_000);
    await client.suggest(USER, QUERY);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const rejected = logs[2]!.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes('DaData отклонил ключ: проверьте DADATA_API_KEY'),
    );
    expect(rejected).toHaveLength(1);
  });

  it('opens the breaker for 60 s on 429', async () => {
    const { client, fetchFn, advance } = setup({ respond: failWith(429) });
    await client.suggest(USER, QUERY);
    advance(59_000);
    await client.suggest(USER, QUERY);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    advance(1_000);
    await client.suggest(USER, QUERY);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it(`stops at ${DADATA_DAILY_BUDGET} upstream calls per Moscow day`, async () => {
    const { client, fetchFn, advance } = setup({ respond: async () => json({ suggestions: [] }) });
    for (let i = 0; i < DADATA_DAILY_BUDGET; i++) {
      await client.suggest(USER, `адрес ${i}`);
    }
    expect(fetchFn).toHaveBeenCalledTimes(DADATA_DAILY_BUDGET);
    expect(await client.suggest(USER, 'ещё один адрес')).toEqual({ status: 'degraded' });
    expect(await client.reverse(USER, POINT)).toEqual({ status: 'degraded' });
    expect(fetchFn).toHaveBeenCalledTimes(DADATA_DAILY_BUDGET);
    // Cached answers don't need the budget.
    expect(await client.suggest(USER, 'адрес 7999')).toEqual({ status: 'ok', value: [] });
    expect(logged()).toContain('Дневной лимит запросов к DaData');

    // 12:00 UTC + 12 h = 03:00 next day in Moscow.
    advance(12 * 3600_000);
    expect(await client.suggest(USER, 'ещё один адрес')).toEqual({ status: 'ok', value: [] });
    expect(fetchFn).toHaveBeenCalledTimes(DADATA_DAILY_BUDGET + 1);
  });

  it('never logs the key, the query, coordinates or upstream bodies', async () => {
    const statuses = [401, 429, 500, 500, 500, 500, 500];
    let call = 0;
    const { client, advance } = setup({
      respond: async () => json({ message: `bad ${KEY}` }, statuses[call++] ?? 500),
    });
    for (let i = 0; i < statuses.length; i++) {
      await client.suggest(USER, `${QUERY} ${i}`);
      await client.reverse(USER, POINT);
      advance(11 * 60_000);
    }
    expect(logs.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    const text = logged();
    for (const secret of [KEY, 'Тверская', String(POINT.lat), '55.7578', 'bad ']) {
      expect(text).not.toContain(secret);
    }
  });
});
