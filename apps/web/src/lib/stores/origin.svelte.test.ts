import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationResult } from '../tg/location.js';

const saved = new Map<string, string>();
const location = {
  access: false,
  result: { kind: 'ok', lat: 55.7558, lng: 37.6173 } as LocationResult,
};
const clock = { now: Date.now() };

vi.mock('../storage.js', () => ({
  storage: {
    get: (key: string) => saved.get(key) ?? null,
    set: (key: string, value: string) => void saved.set(key, value),
    remove: (key: string) => void saved.delete(key),
  },
}));
vi.mock('../tg/location.js', () => ({
  hasLocationAccess: vi.fn(() => Promise.resolve(location.access)),
  requestUserLocation: vi.fn(() => Promise.resolve(location.result)),
}));
vi.mock('./clock.svelte.js', () => ({ clock }));

const { hasLocationAccess, requestUserLocation } = await import('../tg/location.js');

/** A fresh store, as after the Mini App is opened again. */
async function relaunch() {
  vi.resetModules();
  const { origin } = await import('./origin.svelte.js');
  await origin.restore();
  await vi.waitFor(() => expect(origin.silentLocating ?? false).toBe(false));
  return origin;
}

describe('origin across app starts', () => {
  beforeEach(() => {
    saved.clear();
    location.access = false;
    clock.now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
    vi.mocked(requestUserLocation).mockClear();
    vi.mocked(hasLocationAccess).mockClear();
  });

  it('asks on the first start when location access was never given', async () => {
    const origin = await relaunch();
    expect(origin.current).toBeNull();
    expect(requestUserLocation).not.toHaveBeenCalled();
  });

  it('remembers «Не сейчас» as the whole city', async () => {
    (await relaunch()).useWholeCity();
    vi.mocked(hasLocationAccess).mockClear();
    const origin = await relaunch();
    expect(origin.current).toEqual({ kind: 'city' });
    expect(hasLocationAccess).not.toHaveBeenCalled();
  });

  it('reads the location again without asking once access was given', async () => {
    location.access = true;
    await (await relaunch()).locate();
    vi.mocked(requestUserLocation).mockClear();

    const origin = await relaunch();
    expect(origin.current).toMatchObject({ kind: 'geo' });
    expect(requestUserLocation).toHaveBeenCalledTimes(1);
  });

  it('keeps no coordinates in storage', async () => {
    location.access = true;
    await (await relaunch()).locate();
    expect([...saved.values()].join()).not.toMatch(/55|37/);
  });

  it('asks again when access was taken back', async () => {
    location.access = true;
    await (await relaunch()).locate();
    location.access = false;
    expect((await relaunch()).current).toBeNull();
  });

  it('refreshes an old fix without asking', async () => {
    location.access = true;
    const origin = await relaunch();
    await origin.locate();
    clock.now += 16 * 60_000;
    expect(origin.current).toBeNull();
    vi.mocked(requestUserLocation).mockClear();

    await origin.restore();
    await vi.waitFor(() => expect(origin.current).toMatchObject({ kind: 'geo' }));
    expect(requestUserLocation).toHaveBeenCalledTimes(1);
  });

  it('prefers the last choice: a picked station drops the city', async () => {
    (await relaunch()).useWholeCity();
    const { stationById } = await import('@masl/shared/metro');
    const { origin } = await import('./origin.svelte.js');
    await origin.pickStation(stationById('2-dinamo')!);
    expect((await relaunch()).current).toMatchObject({ kind: 'station', id: '2-dinamo' });
  });
});
