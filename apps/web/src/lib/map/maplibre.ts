// MapLibre v6 ships the worker as an ES module that imports a shared chunk next to it, so a
// plain `?url` would copy the worker alone and it would 404 on that import. `?worker&url`
// makes Vite bundle the worker with its imports and gives back its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

type MapLibre = typeof import('maplibre-gl');

let loading: Promise<MapLibre> | undefined;

/** Loads MapLibre once, lazily: only the map tab and the wizard's place step need it. */
export function loadMaplibre(): Promise<MapLibre> {
  loading ??= import('maplibre-gl').then((maplibre) => {
    maplibre.setWorkerUrl(workerUrl);
    return maplibre;
  });
  // A failed import may succeed later (a flaky network), so it is not cached.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}

/** Starts loading MapLibre ahead of a likely tap (the «Карта» tab). */
export function warmMaplibre(): void {
  void loadMaplibre().catch(() => undefined);
}

let webgl2: boolean | undefined;

/** MapLibre v6 needs WebGL2; without it the screens fall back to a list. */
export function hasWebgl2(): boolean {
  if (webgl2 === undefined) {
    const context = document.createElement('canvas').getContext('webgl2');
    webgl2 = context !== null;
    // Free the probe context: browsers cap the number of live WebGL contexts.
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return webgl2;
}
