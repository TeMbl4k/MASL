import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

const PIN = { lat: 55.783_512_3, lng: 37.552_045_6 };
const ADDRESS = 'Новая Башиловка, 14';

describe('api places', () => {
  const fetchMock = vi.fn(async (url: string, _init: RequestInit) => {
    const body = url.includes('/suggest')
      ? { enabled: true, degraded: false, items: [] }
      : { enabled: true, degraded: false, address: null };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Access logs in front of the app record URLs; the exact place must stay out of them.
  it('sends the typed address and the exact pin in a POST body, never in the URL', async () => {
    await api.placeSuggest('token', ADDRESS);
    await api.placeReverse('token', PIN);

    const [[suggestUrl, suggestInit], [reverseUrl, reverseInit]] = fetchMock.mock.calls as [
      [string, RequestInit],
      [string, RequestInit],
    ];
    expect(suggestUrl).toBe('/api/places/suggest');
    expect(suggestInit.method).toBe('POST');
    expect(JSON.parse(String(suggestInit.body))).toEqual({ q: ADDRESS });
    expect(reverseUrl).toBe('/api/places/reverse');
    expect(reverseInit.method).toBe('POST');
    expect(JSON.parse(String(reverseInit.body))).toEqual(PIN);
  });
});

describe('api requests without data', () => {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A tunnel or proxy can forward a bodyless POST as an empty chunked body, which Fastify rejects
  // with 415; an empty JSON object always parses.
  it('send an empty JSON body on approve, reject and cancel', async () => {
    await Promise.allSettled([
      api.approve('token', 'lobby', 'application'),
      api.reject('token', 'lobby', 'application'),
      api.cancelApplication('token', 'lobby'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.body).toBe('{}');
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    }
  });
});
