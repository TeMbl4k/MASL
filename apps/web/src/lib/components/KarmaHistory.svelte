<script lang="ts">
  import type { KarmaEventDto } from '@masl/shared';
  import { api } from '#lib/api.js';
  import { describeError } from '#lib/errors.js';
  import { formatShortDate } from '#lib/format/datetime.js';
  import { KARMA_REASON_LABELS } from '#lib/format/labels.js';
  import { session } from '#lib/session.svelte.js';
  import { useRefreshWhenActive } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { formatKarmaDelta } from './KarmaCard.svelte';

  let items = $state<KarmaEventDto[]>([]);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state<string | null>(null);

  async function load() {
    try {
      const response = await session.authorized((token) => api.karmaEvents(token));
      items = response.items;
      status = 'ready';
    } catch (failure) {
      const shown = describeError(failure);
      if (shown.kind === 'update') toast.error(failure);
      error = shown.kind === 'message' ? shown.text : null;
      // Keep the list already shown; only a first load turns into the error state.
      if (status !== 'ready') status = 'error';
    }
  }

  // Karma changes after meetups: reloaded each time the app comes back.
  useRefreshWhenActive(() => void load());

  function retry() {
    status = 'loading';
    void load();
  }
</script>

<section class="flex flex-col gap-3" aria-labelledby="karma-history-title" aria-busy={status === 'loading'}>
  <h2 id="karma-history-title" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
    История кармы
  </h2>
  {#if status === 'loading'}
    <div class="flex flex-col gap-2" aria-hidden="true">
      <div class="h-5 w-4/5 animate-pulse rounded bg-gray-dark/60"></div>
      <div class="h-5 w-3/5 animate-pulse rounded bg-gray-dark/60"></div>
    </div>
  {:else if status === 'error'}
    <p class="text-sm text-gray-light">
      {error ?? 'Не удалось загрузить историю.'}
      <button type="button" class="ml-1 min-h-11 font-semibold text-brand" onclick={retry}>Повторить</button>
    </p>
  {:else if items.length === 0}
    <p class="text-sm text-gray-light">Пока без изменений</p>
  {:else}
    <ul class="flex flex-col divide-y divide-gray-dark rounded-2xl border border-gray-dark bg-gray-dark/40">
      {#each items as item, index (index)}
        <li>
          <!-- With a lobby the whole row is the link: a full-height tap target. -->
          <svelte:element
            this={item.lobby ? 'a' : 'div'}
            href={item.lobby ? `/lobby/${item.lobby.id}` : undefined}
            class="flex min-h-12 items-baseline gap-3 px-4 py-3 text-sm"
          >
            <span class="w-9 shrink-0 font-bold {item.delta > 0 ? 'text-paper' : 'text-brand-light'}">
              {formatKarmaDelta(item.delta)}
            </span>
            <span class="min-w-0 flex-1">
              {KARMA_REASON_LABELS[item.reason]}
              {#if item.lobby}
                <span class="text-gray-light"
                  >· <span class="underline underline-offset-2">{item.lobby.title}</span></span
                >
              {/if}
            </span>
            <span class="shrink-0 text-gray-light">{formatShortDate(item.createdAt)}</span>
          </svelte:element>
        </li>
      {/each}
    </ul>
  {/if}
</section>
