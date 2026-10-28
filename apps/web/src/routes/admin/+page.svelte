<script lang="ts">
  import {
    normalizeSingleLine,
    USER_SEARCH_MAX,
    USER_SEARCH_MIN,
    type AdminCasesResponse,
    type AdminUserDto,
    type ModerationCaseKind,
  } from '@masl/shared';
  import { onDestroy, untrack } from 'svelte';
  import { api, ApiError } from '#lib/api.js';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import Search from '#lib/components/icons/Search.svelte';
  import AdminTabs from '#lib/components/moderation/AdminTabs.svelte';
  import SubjectCard from '#lib/components/moderation/SubjectCard.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatTimeAgo } from '#lib/format/datetime.js';
  import { CASE_KIND_LABELS } from '#lib/format/labels.js';
  import { caseSummary } from '#lib/moderation.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity, clock } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';

  type Filter = 'all' | ModerationCaseKind;

  const FILTERS: readonly { value: Filter; label: string; count: keyof AdminCasesResponse['counts'] }[] = [
    { value: 'all', label: 'Все', count: 'all' },
    { value: 'reports', label: 'Жалобы', count: 'reports' },
    { value: 'appeal', label: 'Апелляции', count: 'appeal' },
    { value: 'not_held', label: 'Не состоялись', count: 'not_held' },
  ];
  const SEARCH_DEBOUNCE_MS = 300;

  let filter = $state<Filter>('all');
  let data = $state<AdminCasesResponse | null>(null);
  let forbidden = $state(false);
  let loadError = $state<string | null>(null);
  let loading = $state(true);
  let loadingMore = $state(false);
  let controller: AbortController | null = null;

  let query = $state('');
  let found = $state<AdminUserDto[] | null>(null);
  let searchError = $state<string | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchController: AbortController | null = null;

  const searchText = $derived(normalizeSingleLine(query).slice(0, USER_SEARCH_MAX));
  const searching = $derived(searchText.length >= USER_SEARCH_MIN);

  onDestroy(() => {
    clearTimeout(searchTimer);
    controller?.abort();
    searchController?.abort();
  });

  function fail(error: unknown): void {
    if (error instanceof ApiError && error.status === 403) {
      forbidden = true;
      return;
    }
    const shown = describeError(error);
    // With cases on screen a failed refresh is a toast and the list stays.
    if (shown.kind === 'update' || data?.items.length) toast.error(error);
    else {
      loadError = shown.text;
      data = null;
    }
  }

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    const kind = filter === 'all' ? undefined : filter;
    try {
      const next = await session.authorized((token) => api.adminCases(token, { kind }, current.signal));
      data = next;
      loadError = null;
      // The profile badge follows the queue.
      if (session.state.status === 'ready') {
        session.setUser({ ...session.state.user, moderationQueue: next.counts.all });
      }
    } catch (error) {
      if (isAbort(error)) return;
      fail(error);
    }
    if (controller === current) loading = false;
  }

  async function more(): Promise<void> {
    const cursor = data?.nextCursor;
    if (!cursor || loadingMore) return;
    loadingMore = true;
    const kind = filter === 'all' ? undefined : filter;
    try {
      const next = await session.authorized((token) => api.adminCases(token, { kind, cursor }));
      if (data) data = { ...next, items: [...data.items, ...next.items] };
    } catch (error) {
      toast.error(error);
    } finally {
      loadingMore = false;
    }
  }

  $effect(() => {
    void filter;
    if (appActivity.active) untrack(() => void load());
  });

  function pick(next: Filter): void {
    if (next === filter) return;
    haptic.select();
    filter = next;
    loading = true;
    data = data ? { ...data, items: [], nextCursor: null } : null;
  }

  async function search(text: string): Promise<void> {
    searchController?.abort();
    const current = (searchController = new AbortController());
    try {
      const response = await session.authorized((token) => api.adminUsers(token, text, current.signal));
      found = response.items;
      searchError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && error.status === 403) return fail(error);
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else searchError = shown.text;
    }
  }

  function oninput(): void {
    clearTimeout(searchTimer);
    if (!searching) {
      searchController?.abort();
      found = null;
      searchError = null;
      return;
    }
    const text = searchText;
    searchTimer = setTimeout(() => void search(text), SEARCH_DEBOUNCE_MS);
  }
</script>

<svelte:head>
  <title>Модерация — MASL</title>
</svelte:head>

<main class="min-h-app pb-10">
  <PageHeader title="Модерация" subtitle="Очередь дел" />

  <div class="flex flex-col gap-4 px-5 pt-5">
    <AdminTabs />
    {#if forbidden}
      <EmptyState
        title="Раздел только для модераторов"
        text="Если вас назначили недавно, перезапустите приложение."
      />
    {:else}
      <label class="relative block">
        <span class="sr-only">Найти пользователя</span>
        <Search
          size={18}
          class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-light"
        />
        <input
          bind:value={query}
          type="search"
          autocomplete="off"
          enterkeyhint="search"
          maxlength={USER_SEARCH_MAX}
          placeholder="@username, имя или Telegram ID"
          class="min-h-12 w-full rounded-2xl border border-gray-dark bg-gray-dark/40 pr-4 pl-11 text-base text-paper placeholder:text-gray"
          {oninput}
        />
      </label>

      {#if searching}
        <section
          class="flex flex-col gap-2.5"
          aria-label="Пользователи"
          aria-busy={found === null && !searchError}
        >
          {#if searchError}
            <p class="text-sm text-gray-light" role="alert">{searchError}</p>
          {:else if found === null}
            <div class="h-20 animate-pulse rounded-[1.125rem] bg-gray-dark/40"></div>
          {:else if found.length === 0}
            <p class="text-sm text-gray-light">Никого не нашли</p>
          {:else}
            {#each found as user (user.id)}
              <SubjectCard {user} href="/admin/user/{user.id}" />
            {/each}
          {/if}
        </section>
      {:else}
        <div class="flex flex-wrap gap-2" role="group" aria-label="Тип дел">
          {#each FILTERS as option (option.value)}
            {@const active = option.value === filter}
            <button
              type="button"
              aria-pressed={active}
              class="flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-[0.9375rem] {active
                ? 'border-brand bg-brand/20 font-semibold'
                : 'border-gray-dark text-gray-light'}"
              onclick={() => pick(option.value)}
            >
              {option.label}
              {#if data}<span class={active ? 'text-paper' : 'text-gray'}>{data.counts[option.count]}</span
                >{/if}
            </button>
          {/each}
        </div>

        {#if !data && loadError}
          <ErrorState title="Не удалось загрузить очередь" message={loadError} onretry={() => void load()} />
        {:else if !data || (loading && data.items.length === 0)}
          <div class="flex flex-col gap-2.5" aria-busy="true">
            <div class="h-24 animate-pulse rounded-[1.125rem] bg-gray-dark/40"></div>
            <div class="h-24 animate-pulse rounded-[1.125rem] bg-gray-dark/40"></div>
          </div>
        {:else if data.items.length === 0}
          <EmptyState title="Очередь пуста" text="Новые дела появятся здесь, бот напишет о них." />
        {:else}
          <ul class="flex flex-col gap-2.5">
            {#each data.items as item (item.id)}
              <li>
                <a
                  href="/admin/case/{item.id}"
                  class="flex flex-col gap-1.5 rounded-[1.125rem] border px-4 py-3.5 {item.shadowBannedAt
                    ? 'border-brand-light/60 bg-brand-deep/10'
                    : 'border-gray-dark bg-gray-dark/40'}"
                >
                  <span class="flex flex-wrap items-center gap-1.5 text-xs">
                    <span class="rounded-full bg-gray-dark px-2 py-0.5">{CASE_KIND_LABELS[item.kind]}</span>
                    {#if item.shadowBannedAt}
                      <span class="rounded-full bg-brand-deep/40 px-2 py-0.5 text-brand-light"
                        >Теневой бан</span
                      >
                    {/if}
                  </span>
                  <span class="font-semibold"
                    >{item.subject.firstName}
                    <span class="font-normal text-gray-light">· карма {item.subject.karma}</span></span
                  >
                  <span class="text-sm break-words text-paper/85">{caseSummary(item)}</span>
                  <span class="text-[0.8125rem] text-gray-light">
                    {#if item.kind === 'reports' && item.lobby}«{item.lobby.title}» ·
                    {/if}{formatTimeAgo(item.shadowBannedAt ?? item.openedAt, clock.now)}
                  </span>
                </a>
              </li>
            {/each}
          </ul>
          {#if data.nextCursor}
            <button
              type="button"
              class="min-h-11 self-center rounded-xl bg-gray-dark px-5 text-paper disabled:opacity-50"
              disabled={loadingMore}
              aria-busy={loadingMore}
              onclick={() => void more()}
            >
              {loadingMore ? 'Загружаем…' : 'Показать ещё'}
            </button>
          {/if}
        {/if}
      {/if}
    {/if}
  </div>
</main>
