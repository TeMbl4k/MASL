<script lang="ts">
  import {
    LOBBY_ADDRESS_MAX,
    normalizeSingleLine,
    PLACE_QUERY_MAX,
    PLACE_QUERY_MIN,
    PLACE_SUGGESTIONS_MAX,
    type GeoPointDto,
    type PlaceSuggestionDto,
  } from '@masl/shared';
  import { onDestroy, tick } from 'svelte';
  import { api } from '#lib/api.js';
  import { describeError, isAbort } from '#lib/errors.js';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';

  interface Props {
    value: string;
    /** The host typed or picked the address: reverse geocoding must not overwrite it. */
    touched: boolean;
    /** DaData suggestions are configured (creation-context `addressSuggest`). */
    suggest: boolean;
    /** DaData failed: the field works as plain text and a note says so. */
    degraded: boolean;
    /** Error text, shown after a «Далее» attempt. */
    error?: string;
    /** A suggestion with a point was picked: the pin moves there. */
    onpick?: (point: GeoPointDto) => void;
    /** The host typed in the field (not a pick). */
    onedit?: () => void;
  }

  let {
    value = $bindable(),
    touched = $bindable(),
    suggest,
    degraded = $bindable(),
    error,
    onpick,
    onedit,
  }: Props = $props();

  const DEBOUNCE_MS = 300;

  const id = $props.id();
  let items = $state<PlaceSuggestionDto[]>([]);
  let open = $state(false);
  let active = $state(-1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;

  let list = $state<HTMLUListElement | null>(null);

  onDestroy(() => {
    clearTimeout(timer);
    controller?.abort();
  });

  function close() {
    open = false;
    active = -1;
  }

  async function fetchSuggestions(query: string) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      const response = await session.authorized((token) => api.placeSuggest(token, query, current.signal));
      if (controller !== current) return;
      degraded = response.degraded;
      items = response.enabled ? response.items.slice(0, PLACE_SUGGESTIONS_MAX) : [];
      active = -1;
      open = items.length > 0;
      await tick();
      // 'end' honours the scroll margin, so the list clears the bottom button ('nearest' doesn't).
      if (open) list?.scrollIntoView({ block: 'end' });
    } catch (failure) {
      if (isAbort(failure)) return;
      // Suggestions are optional: only a stale app is worth interrupting for.
      if (describeError(failure).kind === 'update') toast.error(failure);
      items = [];
      close();
    }
  }

  function oninput() {
    touched = value.trim() !== '';
    onedit?.();
    if (!suggest) return;
    clearTimeout(timer);
    const query = normalizeSingleLine(value).slice(0, PLACE_QUERY_MAX);
    if (query.length < PLACE_QUERY_MIN) {
      controller?.abort();
      items = [];
      close();
      return;
    }
    timer = setTimeout(() => void fetchSuggestions(query), DEBOUNCE_MS);
  }

  function pick(item: PlaceSuggestionDto) {
    haptic.select();
    value = item.value;
    touched = true;
    items = [];
    close();
    if (item.point) onpick?.(item.point);
  }

  function onkeydown(event: KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + items.length) % items.length;
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  const describedBy = $derived(
    [error ? `${id}-error` : null, suggest && degraded ? `${id}-degraded` : null].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="flex flex-col gap-2">
  <label for="{id}-input" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
    Адрес и как найти
  </label>
  <input
    id="{id}-input"
    type="text"
    bind:value
    {oninput}
    {onkeydown}
    onblur={close}
    maxlength={LOBBY_ADDRESS_MAX}
    autocomplete="off"
    placeholder="Улица, дом, как найти — например, «вход со двора»"
    role={suggest ? 'combobox' : undefined}
    aria-autocomplete={suggest ? 'list' : undefined}
    aria-expanded={suggest ? open : undefined}
    aria-controls={suggest ? `${id}-list` : undefined}
    aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
    aria-invalid={error ? true : undefined}
    aria-describedby={describedBy}
    class="w-full rounded-2xl border bg-gray-dark/40 px-4 py-3.5 text-[0.9375rem] text-paper placeholder:text-gray {error
      ? 'border-brand-light'
      : 'border-gray-dark'}"
  />
  {#if suggest}
    <!-- In the flow, not floating: it stays reachable above the keyboard and the bottom button. -->
    <ul
      bind:this={list}
      id="{id}-list"
      role="listbox"
      aria-label="Подсказки адреса"
      class="flex scroll-mb-36 flex-col overflow-hidden rounded-2xl border border-gray-dark bg-[color-mix(in_srgb,var(--color-gray-dark)_60%,var(--color-ink))] {open
        ? ''
        : 'hidden'}"
    >
      {#each items as item, index (index)}
        <!-- pointerdown keeps the focus in the input, so blur doesn't close the list before the pick. -->
        <li
          id="{id}-option-{index}"
          role="option"
          aria-selected={index === active}
          class="flex min-h-12 cursor-pointer items-center px-4 py-2 text-[0.9375rem] {index === active
            ? 'bg-gray-dark'
            : ''}"
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => pick(item)}
          onkeydown={(event) => event.key === 'Enter' && pick(item)}
          onpointerenter={() => (active = index)}
        >
          {item.value}
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}
    <p id="{id}-error" class="text-sm text-brand-light" role="alert">{error}</p>
  {/if}
  {#if suggest && degraded}
    <p id="{id}-degraded" class="text-[0.8125rem] text-gray-light">
      Подсказки адресов временно недоступны — поставьте точку на карте
    </p>
  {/if}
</div>
