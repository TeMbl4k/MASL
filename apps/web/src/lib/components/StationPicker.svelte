<script lang="ts">
  import type { StationEntry, StationGroup } from '@masl/shared/metro';
  import { onMount } from 'svelte';
  import { origin } from '#lib/stores/origin.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import Search from './icons/Search.svelte';

  interface Props {
    /** Called with the picked station (of a same-name group, the first line in line order). */
    onpick: (entry: StationEntry, group: StationGroup) => void;
    /** Focus the search field when shown (in a sheet). */
    autofocus?: boolean;
  }

  let { onpick, autofocus = false }: Props = $props();

  type Metro = typeof import('@masl/shared/metro');
  let metro = $state<Metro | null>(null);
  let failed = $state(false);
  let query = $state('');
  let active = $state(0);
  let input = $state<HTMLInputElement | null>(null);

  const listId = $props.id();

  onMount(() => {
    import('@masl/shared/metro').then(
      (module) => (metro = module),
      () => (failed = true),
    );
    if (autofocus) input?.focus({ preventScroll: true });
  });

  /** «Недавние»: the last picked stations, shown while the query is empty. */
  const recent = $derived.by((): StationGroup[] => {
    if (!metro || query.trim()) return [];
    const { stationById } = metro;
    return origin.recentIds.flatMap((id) => {
      const entry = stationById(id);
      return entry && !entry.station.closed ? [{ name: entry.station.name, entries: [entry] }] : [];
    });
  });
  const results = $derived(metro ? metro.searchStations(query) : []);
  const rows = $derived([...recent, ...results]);

  $effect(() => {
    // A new query starts from the first row.
    void query;
    active = 0;
  });

  function pick(group: StationGroup) {
    const entry = group.entries[0];
    if (!entry) return;
    haptic.select();
    onpick(entry, group);
  }

  function onkeydown(event: KeyboardEvent) {
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % rows.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + rows.length) % rows.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(rows[active]);
    }
  }

  $effect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div class="flex flex-col gap-3">
  <label class="relative block">
    <span class="sr-only">Станция метро или МЦК</span>
    <Search size={18} class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-light" />
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      role="combobox"
      aria-expanded="true"
      aria-controls={listId}
      aria-activedescendant={rows.length ? `${listId}-${active}` : undefined}
      aria-autocomplete="list"
      autocomplete="off"
      enterkeyhint="search"
      placeholder="Станция метро или МЦК"
      class="min-h-12 w-full rounded-2xl border border-gray-dark bg-gray-dark/40 pr-4 pl-11 text-base text-paper placeholder:text-gray"
      {onkeydown}
    />
  </label>

  {#if failed}
    <p class="text-gray-light" role="alert">Не удалось загрузить список станций. Проверьте интернет.</p>
  {:else if !metro}
    <p class="text-gray-light" aria-busy="true">Загружаем станции…</p>
  {:else if rows.length === 0}
    <p class="text-gray-light">Такой станции не нашлось</p>
  {:else}
    <ul id={listId} role="listbox" aria-label="Станции" class="-mx-2 flex flex-col">
      {#each rows as group, index (`${index < recent.length ? 'recent' : 'all'}-${group.name}`)}
        {#if index === 0 && recent.length > 0}
          <li role="presentation" class="px-2 pt-1 pb-1 text-xs tracking-widest text-gray-light uppercase">
            Недавние
          </li>
        {:else if index === recent.length && recent.length > 0}
          <li role="presentation" class="px-2 pt-3 pb-1 text-xs tracking-widest text-gray-light uppercase">
            Все станции
          </li>
        {/if}
        <li
          id="{listId}-{index}"
          role="option"
          aria-selected={index === active}
          class="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2 {index === active
            ? 'bg-gray-dark/60'
            : ''}"
          onclick={() => pick(group)}
          onkeydown={(event) => event.key === 'Enter' && pick(group)}
          onpointerenter={() => (active = index)}
        >
          <span class="flex shrink-0 gap-1" aria-hidden="true">
            {#each group.entries as entry (entry.station.id)}
              <span class="size-2.5 rounded-full" style:background-color={entry.line.color}></span>
            {/each}
          </span>
          <span class="min-w-0 flex-1 truncate">{group.name}</span>
          <span class="shrink-0 truncate text-xs text-gray-light">
            {group.entries.map((e) => (e.line.kind === 'mcc' ? 'МЦК' : e.line.name)).join(', ')}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
