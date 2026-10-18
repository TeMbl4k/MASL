<script module lang="ts">
  import type { MapResponse } from '@masl/shared';

  /** Refetched when older than this, as on the other tab roots. */
  const STALE_MS = 60_000;

  /** Map data outlives the page, so switching tabs back and forth doesn't refetch every time. */
  const cache = $state<{
    data: MapResponse | null;
    /** Query of `data`. */
    dataKey: string | null;
    loadedAt: number;
    /** Query being loaded, or null. */
    loadingKey: string | null;
    error: string | null;
  }>({ data: null, dataKey: null, loadedAt: 0, loadingKey: null, error: null });
</script>

<script lang="ts">
  import { isInMoscowBounds, MAP_LOBBIES_MAX, MOSCOW_CENTER, type GeoPointDto } from '@masl/shared';
  import { onMount, untrack, type Component, type ComponentProps } from 'svelte';
  import { page } from '$app/state';
  import CategoryChips from '#lib/components/CategoryChips.svelte';
  import DayStrip from '#lib/components/DayStrip.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import List from '#lib/components/icons/List.svelte';
  import Locate from '#lib/components/icons/Locate.svelte';
  import LobbyCard from '#lib/components/LobbyCard.svelte';
  import LobbyCardSkeleton from '#lib/components/LobbyCardSkeleton.svelte';
  import MapPlaceSheet from '#lib/components/MapPlaceSheet.svelte';
  import { api } from '#lib/api.js';
  import { describeError, isAbort } from '#lib/errors.js';
  import { LOBBY_FORMS, plural } from '#lib/format/plural.js';
  import { groupPlaces } from '#lib/map/group-places.js';
  import { hasWebgl2 } from '#lib/map/maplibre.js';
  import type LobbyMapType from '#lib/map/LobbyMap.svelte';
  import MapPlaceholder from '#lib/map/MapPlaceholder.svelte';
  import { MAP_CITY_ZOOM, MAP_NEAR_ZOOM } from '#lib/map/style.js';
  import { session } from '#lib/session.svelte.js';
  import { useRefreshWhenActive } from '#lib/stores/clock.svelte.js';
  import { filters } from '#lib/stores/filters.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { origin } from '#lib/stores/origin.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { openSheet } from '#lib/tg/back.svelte.js';
  import { requestUserLocation } from '#lib/tg/location.js';
  import { useNoVerticalSwipes } from '#lib/tg/swipes.svelte.js';

  useNoVerticalSwipes();

  let controller: AbortController | null = null;

  async function load(force = false): Promise<void> {
    const query = filters.query;
    const key = JSON.stringify(query);
    if (!force && cache.loadingKey === key) return;
    if (!force && cache.dataKey === key && Date.now() - cache.loadedAt < STALE_MS) return;
    controller?.abort();
    const current = (controller = new AbortController());
    cache.loadingKey = key;
    cache.error = null;
    try {
      const data = await session.authorized((token) => api.map(token, query, current.signal));
      for (const station of data.stations) station.lobbies.forEach((card) => lobbyCache.prime(card));
      cache.data = data;
      cache.dataKey = key;
      cache.loadedAt = Date.now();
    } catch (error) {
      if (isAbort(error)) return;
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else cache.error = shown.text;
    } finally {
      if (controller === current) cache.loadingKey = null;
    }
  }

  const queryKey = $derived(JSON.stringify(filters.query));
  $effect(() => {
    void queryKey;
    untrack(() => void load());
  });
  useRefreshWhenActive(() => void load());

  const places = $derived(cache.data && cache.dataKey === queryKey ? groupPlaces(cache.data.stations) : []);
  const selected = $derived(places.find((place) => place.key === page.state.placeKey) ?? null);
  const ready = $derived(cache.dataKey === queryKey && cache.loadingKey === null);
  const loading = $derived(cache.loadingKey !== null);

  // Where the camera starts: the viewer's location if known, otherwise the city centre.
  const start = untrack(() => {
    const value = origin.current;
    return value?.kind === 'geo'
      ? { center: { lat: value.lat, lng: value.lng }, zoom: MAP_NEAR_ZOOM }
      : { center: MOSCOW_CENTER, zoom: MAP_CITY_ZOOM };
  });

  /** The viewer's dot; from «Где я» it is never sent anywhere. */
  let user = $state<GeoPointDto | null>(start.zoom === MAP_NEAR_ZOOM ? start.center : null);
  let locating = $state(false);
  let mapFailed = $state(!hasWebgl2());
  let lobbyMap = $state<{ focus: (point: GeoPointDto, zoom?: number) => void } | null>(null);
  let LobbyMap = $state<Component<
    ComponentProps<typeof LobbyMapType>,
    { focus: (point: GeoPointDto, zoom?: number) => void }
  > | null>(null);

  onMount(() => {
    if (mapFailed) return;
    import('#lib/map/LobbyMap.svelte').then(
      (module) => (LobbyMap = module.default),
      () => (mapFailed = true),
    );
  });

  async function whereAmI() {
    locating = true;
    try {
      const result = await requestUserLocation();
      if (result.kind === 'ok') {
        if (!isInMoscowBounds(result)) {
          toast.show('Вы далеко от Москвы');
          return;
        }
        user = { lat: result.lat, lng: result.lng };
        lobbyMap?.focus(user, MAP_NEAR_ZOOM);
      } else if (result.kind === 'denied') {
        toast.show('Доступ к геолокации выключен. Включите его в настройках.', 'error');
      } else {
        toast.show('Геолокация недоступна на этом устройстве', 'error');
      }
    } finally {
      locating = false;
    }
  }

  function select(key: string) {
    void openSheet('map-place', { placeKey: key });
  }
</script>

<svelte:head>
  <title>Карта — MASL</title>
</svelte:head>

{#snippet filterBar(floating: boolean)}
  <CategoryChips bind:value={filters.category} {floating} />
  <DayStrip bind:value={filters.day} compact={floating} />
{/snippet}

{#if mapFailed}
  <main class="min-h-app">
    <header class="flex flex-col gap-4 px-5 pt-5">
      <h1 tabindex="-1" class="text-3xl font-light tracking-tight outline-none">Карта</h1>
      <p class="text-sm text-gray-light">Карта недоступна на этом устройстве — показываем списком</p>
      {@render filterBar(false)}
    </header>
    <div class="flex flex-col gap-6 px-5 pt-5" aria-busy={loading}>
      {#if !ready && cache.error}
        <ErrorState
          title="Не удалось загрузить встречи"
          message={cache.error}
          onretry={() => void load(true)}
        />
      {:else if !ready && places.length === 0}
        <LobbyCardSkeleton variant="compact" />
        <LobbyCardSkeleton variant="compact" />
      {:else if places.length === 0}
        <EmptyState title="Пока тихо" text="Встреч с такими фильтрами пока нет." />
      {:else}
        {#each places as place (place.key)}
          <section class="flex flex-col gap-2.5">
            <h2 class="flex items-center gap-2 font-semibold">
              {#each place.lineColors as color (color)}
                <span class="size-2.5 rounded-full" style:background-color={color} aria-hidden="true"></span>
              {/each}
              {place.hint} · {plural(place.lobbies.length, LOBBY_FORMS)}
            </h2>
            {#each place.lobbies as lobby (lobby.id)}
              <LobbyCard {lobby} variant="compact" />
            {/each}
          </section>
        {/each}
      {/if}
    </div>
  </main>
{:else}
  <!-- Pinned between the top inset and the tab bar, so the map's bottom edge is the bar's top. -->
  <main
    class="fixed inset-x-0 top-(--safe-top) bottom-[calc(var(--tab-bar-height)+var(--safe-bottom))] overflow-hidden"
  >
    <h1 class="sr-only" tabindex="-1">Карта встреч</h1>
    {#if LobbyMap}
      <LobbyMap
        bind:this={lobbyMap}
        {places}
        {user}
        center={start.center}
        zoom={start.zoom}
        onselect={select}
        onfail={() => (mapFailed = true)}
      />
    {:else}
      <MapPlaceholder />
    {/if}

    <div class="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2.5 px-5 pt-4">
      <div class="pointer-events-auto flex flex-col gap-2.5">{@render filterBar(true)}</div>
      {#if cache.data?.truncated && ready}
        <p class="self-start rounded-full bg-ink/90 px-3 py-1.5 text-xs text-gray-light">
          Показаны ближайшие по времени {MAP_LOBBIES_MAX} встреч
        </p>
      {:else if ready && places.length === 0}
        <p class="self-start rounded-full bg-ink/90 px-3 py-1.5 text-sm text-gray-light">
          Встреч с такими фильтрами пока нет
        </p>
      {:else if cache.error && !loading}
        <p
          class="pointer-events-auto flex items-center gap-2 self-start rounded-full bg-ink/90 p-0.5 pl-3 text-sm"
          role="alert"
        >
          {cache.error}
          <button
            type="button"
            class="min-h-11 rounded-full bg-gray-dark px-4"
            onclick={() => void load(true)}
          >
            Обновить
          </button>
        </p>
      {/if}
    </div>

    <div class="absolute inset-x-0 bottom-0 flex justify-between gap-3 px-4 pb-3">
      <button
        type="button"
        class="flex min-h-11 items-center gap-2 rounded-full border border-gray-dark bg-ink/90 px-3.5 text-sm disabled:opacity-60"
        disabled={locating}
        onclick={() => void whereAmI()}
      >
        <Locate size={18} />
        {locating ? 'Ищем…' : 'Где я'}
      </button>
      <a
        href="/"
        class="flex min-h-11 items-center gap-2 rounded-full border border-gray-dark bg-ink/90 px-3.5 text-sm"
      >
        <List size={18} />
        Списком
      </a>
    </div>
  </main>
{/if}

<MapPlaceSheet place={selected} />

<style>
  /* The credits' «i» sits above «Где я» and «Списком», which keep the map's bottom edge. */
  main :global(.maplibregl-ctrl-bottom-right) {
    bottom: 3.5rem;
  }
</style>
