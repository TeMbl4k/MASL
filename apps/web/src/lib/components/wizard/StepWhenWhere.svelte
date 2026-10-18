<script lang="ts">
  import {
    addMoscowDays,
    classifyMetroDistance,
    isInMoscowBounds,
    LOBBY_MAX_DAYS_AHEAD,
    MOSCOW_CENTER,
    moscowDayKey,
    OUTSIDE_MOSCOW_MESSAGE,
    PLACE_TOO_FAR_MESSAGE,
    type GeoPointDto,
  } from '@masl/shared';
  import type { StationEntry } from '@masl/shared/metro';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { api } from '#lib/api.js';
  import { describeError, isAbort } from '#lib/errors.js';
  import type LocationPickerComponent from '#lib/map/LocationPicker.svelte';
  import { hasWebgl2 } from '#lib/map/maplibre.js';
  import { session } from '#lib/session.svelte.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { origin } from '#lib/stores/origin.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet, openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { useNoVerticalSwipes } from '#lib/tg/swipes.svelte.js';
  import { quickStarts, sameWallTime, type WallTime } from '#lib/wizard/defaults.js';
  import type { LobbyDraft } from '#lib/wizard/draft.svelte.js';
  import { fallbackPoint } from '#lib/wizard/place.js';
  import type { StepIssues } from '#lib/wizard/validate.js';
  import DayStrip from '../DayStrip.svelte';
  import ChevronDown from '../icons/ChevronDown.svelte';
  import Lock from '../icons/Lock.svelte';
  import Sheet from '../Sheet.svelte';
  import StationPicker from '../StationPicker.svelte';
  import AddressField from './AddressField.svelte';
  import DurationChips from './DurationChips.svelte';
  import TimeSelect from './TimeSelect.svelte';

  interface Props {
    draft: LobbyDraft;
    /** Shown only after a «Далее» attempt. */
    issues: StepIssues;
    /** DaData suggestions and reverse geocoding are configured. */
    addressSuggest: boolean;
  }

  let { draft, issues, addressSuggest }: Props = $props();

  const id = $props.id();
  const REVERSE_DEBOUNCE_MS = 600;

  // The map pans with one finger; a vertical swipe must not minimise the Mini App.
  useNoVerticalSwipes();

  // When

  const today = $derived(moscowDayKey(clock.now));
  const quick = $derived(quickStarts(clock.now));
  /** Lobbies today or tomorrow fill up faster: the hint lights up for later days. */
  const later = $derived(draft.day >= addMoscowDays(today, 2));
  const current = $derived<WallTime>({ day: draft.day, hour: draft.hour, minute: draft.minute });

  function applyQuick(start: WallTime) {
    haptic.select();
    draft.day = start.day;
    draft.hour = start.hour;
    draft.minute = start.minute;
  }

  // Where: a map with a centred pin, or a station list without WebGL2.

  type Mode = 'detect' | 'map' | 'list';
  let mode = $state<Mode>('detect');
  let Picker = $state<typeof LocationPickerComponent | null>(null);
  let picker = $state<{ jumpTo(point: GeoPointDto): void } | null>(null);
  let degraded = $state(false);

  /** The pin, else the viewer's origin (rounded), else the city centre. */
  const initialCenter = untrack((): GeoPointDto => draft.point ?? origin.point ?? MOSCOW_CENTER);

  onMount(() => {
    void draft.loadMetro();
    if (!hasWebgl2()) {
      mode = 'list';
      return;
    }
    mode = 'map';
    import('#lib/map/LocationPicker.svelte').then(
      (module) => (Picker = module.default),
      () => (mode = 'list'),
    );
  });

  let reverseTimer: ReturnType<typeof setTimeout> | undefined;
  let reverseController: AbortController | null = null;

  onDestroy(() => {
    clearTimeout(reverseTimer);
    reverseController?.abort();
  });

  /** Prefills the address from the pin until the host types one (DaData reverse geocoding). */
  async function reverseGeocode(point: GeoPointDto) {
    reverseController?.abort();
    const controller = new AbortController();
    reverseController = controller;
    try {
      const response = await session.authorized((token) => api.placeReverse(token, point, controller.signal));
      if (reverseController !== controller) return;
      degraded = response.degraded;
      if (response.address && !draft.addressTouched) draft.address = response.address;
    } catch (error) {
      if (isAbort(error)) return;
      if (describeError(error).kind === 'update') toast.error(error);
    }
  }

  function onPinMove(point: GeoPointDto) {
    draft.point = point;
    if (!addressSuggest || draft.addressTouched || !isInMoscowBounds(point)) return;
    clearTimeout(reverseTimer);
    reverseTimer = setTimeout(() => void reverseGeocode(point), REVERSE_DEBOUNCE_MS);
  }

  /** A suggestion with a point moves the pin (or, without a map, becomes the point). */
  function onSuggestionPoint(point: GeoPointDto) {
    draft.suggestionPoint = point;
    draft.point = point;
    picker?.jumpTo(point);
  }

  /** A hand-edited address may be another place: a later station pick sets the point again. */
  function onAddressEdit() {
    draft.suggestionPoint = null;
  }

  const station = $derived(
    draft.metro && draft.fallbackStationId ? draft.metro.stationById(draft.fallbackStationId) : null,
  );

  function pickStation(entry: StationEntry) {
    draft.fallbackStationId = entry.station.id;
    draft.point = fallbackPoint(draft.suggestionPoint, entry.station);
    origin.rememberStation(entry.station.id);
    closeSheet();
  }

  /** Live preview of what becomes public, with the place errors before any «Далее». */
  const preview = $derived.by(() => {
    const point = draft.point;
    if (!point) return null;
    if (!isInMoscowBounds(point)) return { error: OUTSIDE_MOSCOW_MESSAGE } as const;
    const nearest = draft.nearest;
    const place = draft.publicPlace;
    if (!nearest || !place) return null;
    if (classifyMetroDistance(nearest.distanceM) === 'too_far')
      return { error: PLACE_TOO_FAR_MESSAGE } as const;
    return { place } as const;
  });

  /** The missing-pin error; the other place errors are already in the preview. */
  const pinError = $derived(draft.point ? undefined : issues.location);
</script>

<section class="flex flex-col gap-3.5" aria-labelledby="{id}-when">
  <h2 id="{id}-when" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">Когда</h2>
  {#if quick.length > 0}
    <div class="flex flex-wrap gap-2">
      {#each quick as chip (chip.label)}
        {@const pressed = sameWallTime(chip.start, current)}
        <button
          type="button"
          aria-pressed={pressed}
          class="min-h-11 rounded-full border px-4 text-sm transition {pressed
            ? 'border-brand bg-brand/20 font-medium text-paper'
            : 'border-gray-dark bg-gray-dark/40 text-paper'}"
          onclick={() => applyQuick(chip.start)}
        >
          {chip.label}
        </button>
      {/each}
    </div>
  {/if}
  <DayStrip
    value={draft.day}
    onchange={(day) => {
      if (day) draft.day = day;
    }}
    count={LOBBY_MAX_DAYS_AHEAD + 1}
    allowAll={false}
    showMonths
  />
  <p class="text-[0.8125rem] leading-snug {later ? 'text-sand' : 'text-gray-light'}">
    💡 События на сегодня-завтра собирают людей в 3 раза быстрее
  </p>
  <TimeSelect
    bind:hour={draft.hour}
    bind:minute={draft.minute}
    invalid={!!issues.startsAt}
    describedBy={issues.startsAt ? `${id}-start-error` : undefined}
  />
  {#if issues.startsAt}
    <p id="{id}-start-error" class="-mt-1 text-sm text-brand-light" role="alert">{issues.startsAt}</p>
  {/if}
  <DurationChips bind:value={draft.durationMinutes} endsAt={draft.endsAt} />
</section>

<section class="flex flex-col gap-3" aria-labelledby="{id}-where">
  <h2 id="{id}-where" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">Где</h2>
  {#if mode === 'map'}
    {#if Picker}
      <Picker
        bind:this={picker}
        point={draft.point}
        {initialCenter}
        onmove={onPinMove}
        onfail={() => (mode = 'list')}
      />
    {:else}
      <div class="h-60 animate-pulse rounded-2xl border border-gray-dark bg-gray-dark/40" aria-busy="true">
        <span class="sr-only">Загружаем карту…</span>
      </div>
    {/if}
  {:else if mode === 'list'}
    <p class="text-[0.8125rem] text-gray-light">
      Карта недоступна на этом устройстве — выберите ближайшую станцию
    </p>
    <button
      type="button"
      aria-describedby={pinError ? `${id}-place-error` : undefined}
      class="flex min-h-12 items-center justify-between gap-3 rounded-2xl border bg-gray-dark/40 px-4 text-left {pinError
        ? 'border-brand-light'
        : 'border-gray-dark'}"
      onclick={() => openSheet('station')}
    >
      {#if station}
        <span class="flex min-w-0 items-center gap-2">
          <span
            class="size-2.5 shrink-0 rounded-full"
            style:background-color={station.line.color}
            aria-hidden="true"
          ></span>
          <span class="truncate">{station.station.name}</span>
        </span>
        <span class="shrink-0 text-sm text-gray-light">Изменить</span>
      {:else}
        <span class="text-gray">Ближайшая станция метро или МЦК</span>
        <ChevronDown size={18} class="text-gray-light" />
      {/if}
    </button>
  {/if}
  {#if pinError}
    <p id="{id}-place-error" class="text-sm text-brand-light" role="alert">{pinError}</p>
  {/if}
  {#if preview}
    <div
      class="flex flex-col gap-1 rounded-2xl border px-3.5 py-3 {preview.error
        ? 'border-brand-light/60 bg-brand-deep/10'
        : 'border-transparent bg-gray-dark/40'}"
      role="status"
    >
      {#if preview.error}
        <p class="text-sm text-brand-light">{preview.error}</p>
      {:else}
        <p class="flex flex-wrap items-center gap-1.5 text-sm">
          Участники увидят:
          {#if preview.place.lineColor}
            <span
              class="size-2.5 rounded-full"
              style:background-color={preview.place.lineColor}
              aria-hidden="true"
            ></span>
          {/if}
          <b class="font-semibold">{preview.place.hint}</b>
          {#if preview.place.farFromMetro}
            <span class="rounded-full border border-sand/60 px-2 py-0.5 text-xs text-sand"
              >далеко от метро</span
            >
          {/if}
        </p>
        <p class="flex items-center gap-1.5 text-[0.8125rem] text-gray-light">
          <Lock size={14} />
          Точный адрес — только одобренным участникам
        </p>
      {/if}
    </div>
  {/if}
</section>

<AddressField
  bind:value={draft.address}
  bind:touched={draft.addressTouched}
  bind:degraded
  suggest={addressSuggest}
  error={issues.address}
  onpick={onSuggestionPoint}
  onedit={onAddressEdit}
/>

<Sheet name="station" title="Ближайшая станция">
  <StationPicker onpick={pickStation} autofocus />
</Sheet>
