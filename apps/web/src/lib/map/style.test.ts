import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { attachStyleFallback, MAP_STYLE_FALLBACK_URL } from './style.js';

/** The few map events the fallback listens to. */
function fakeMap() {
  const handlers = new Map<string, (() => void)[]>();
  const setStyle = vi.fn();
  const map = {
    on(type: string, handler: () => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      return map;
    },
    setStyle,
  };
  const fire = (type: string) => handlers.get(type)?.forEach((handler) => handler());
  return { map: map as unknown as MapLibreMap, setStyle, fire };
}

describe('attachStyleFallback', () => {
  it('switches to the fallback style, then gives up when that fails too', () => {
    const { map, setStyle, fire } = fakeMap();
    const onfail = vi.fn();
    attachStyleFallback(map, onfail);

    fire('error');
    expect(setStyle).toHaveBeenCalledOnce();
    expect(setStyle.mock.calls[0][0]).toBe(MAP_STYLE_FALLBACK_URL);
    expect(onfail).not.toHaveBeenCalled();

    fire('error');
    expect(onfail).toHaveBeenCalledOnce();
  });

  it('ignores tile errors once a style has loaded', () => {
    const { map, setStyle, fire } = fakeMap();
    const onfail = vi.fn();
    attachStyleFallback(map, onfail);

    fire('style.load');
    fire('error');
    fire('error');
    fire('error');
    expect(setStyle).not.toHaveBeenCalled();
    expect(onfail).not.toHaveBeenCalled();
  });

  it('keeps the fallback style when only its tiles fail', () => {
    const { map, setStyle, fire } = fakeMap();
    const onfail = vi.fn();
    attachStyleFallback(map, onfail);

    fire('error');
    fire('style.load');
    fire('error');
    fire('error');
    expect(setStyle).toHaveBeenCalledOnce();
    expect(onfail).not.toHaveBeenCalled();
  });
});
