<script lang="ts">
  import { addMoscowDays, LOBBY_ADDRESS_MAX, LOBBY_MAX_DAYS_AHEAD, moscowDayKey } from '@masl/shared';
  import type { StationEntry } from '@masl/shared/metro';
  import { onMount } from 'svelte';
  import { origin } from '#lib/stores/origin.svelte.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { closeSheet, openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { useNoVerticalSwipes } from '#lib/tg/swipes.svelte.js';
  import { quickStarts, sameWallTime, type WallTime } from '#lib/wizard/defaults.js';
  import type { LobbyDraft } from '#lib/wizard/draft.svelte.js';
  import type { StepIssues } from '#lib/wizard/validate.js';
  import DayStrip from '../DayStrip.svelte';
  import ChevronDown from '../icons/ChevronDown.svelte';
  import Lock from '../icons/Lock.svelte';
  import Sheet from '../Sheet.svelte';
  import StationPicker from '../StationPicker.svelte';
  import DurationChips from './DurationChips.svelte';
  import TimeSelect from './TimeSelect.svelte';

  interface Props {
    draft: LobbyDraft;
    /** Shown only after a «Далее» attempt. */
    issues: StepIssues;
  }

  let { draft, issues }: Props = $props();

  const id = $props.id();

  // The map pans with one finger; a vertical swipe must not minimise the Mini App.
  useNoVerticalSwipes();

  onMount(() => {
    void draft.loadMetro();
  });

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

  const station = $derived(
    draft.metro && draft.fallbackStationId ? draft.metro.stationById(draft.fallbackStationId) : null,
  );

  function pickStation(entry: StationEntry) {
    draft.fallbackStationId = entry.station.id;
    draft.point = { lat: entry.station.lat, lng: entry.station.lng };
    origin.rememberStation(entry.station.id);
    closeSheet();
  }

  function onAddressInput() {
    draft.addressTouched = draft.address.trim() !== '';
  }

  const fieldClass = (invalid: boolean) =>
    `w-full rounded-2xl border bg-gray-dark/40 px-4 py-3.5 text-[0.9375rem] text-paper placeholder:text-gray ${
      invalid ? 'border-brand-light' : 'border-gray-dark'
    }`;
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
  <button
    type="button"
    aria-describedby={issues.location ? `${id}-place-error` : undefined}
    class="flex min-h-12 items-center justify-between gap-3 rounded-2xl border bg-gray-dark/40 px-4 text-left {issues.location
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
  {#if issues.location}
    <p id="{id}-place-error" class="text-sm text-brand-light" role="alert">{issues.location}</p>
  {/if}
  {#if draft.publicPlace}
    <div class="flex flex-col gap-1 rounded-2xl bg-gray-dark/40 px-3.5 py-3">
      <p class="flex flex-wrap items-center gap-1.5 text-sm">
        Участники увидят:
        {#if draft.publicPlace.lineColor}
          <span
            class="size-2.5 rounded-full"
            style:background-color={draft.publicPlace.lineColor}
            aria-hidden="true"
          ></span>
        {/if}
        <b class="font-semibold">{draft.publicPlace.hint}</b>
      </p>
      <p class="flex items-center gap-1.5 text-[0.8125rem] text-gray-light">
        <Lock size={14} />
        Точный адрес — только одобренным участникам
      </p>
    </div>
  {/if}
</section>

<div class="flex flex-col gap-2">
  <label for="{id}-address" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
    Адрес и как найти
  </label>
  <input
    id="{id}-address"
    type="text"
    bind:value={draft.address}
    oninput={onAddressInput}
    maxlength={LOBBY_ADDRESS_MAX}
    autocomplete="off"
    placeholder="Улица, дом, как найти — например, «вход со двора»"
    aria-invalid={issues.address ? true : undefined}
    aria-describedby={issues.address ? `${id}-address-error` : undefined}
    class={fieldClass(!!issues.address)}
  />
  {#if issues.address}
    <p id="{id}-address-error" class="text-sm text-brand-light" role="alert">{issues.address}</p>
  {/if}
</div>

<Sheet name="station" title="Ближайшая станция">
  <StationPicker onpick={pickStation} autofocus />
</Sheet>
