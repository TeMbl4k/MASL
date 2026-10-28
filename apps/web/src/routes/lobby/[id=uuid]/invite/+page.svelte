<script lang="ts">
  import {
    INVITES_PER_REQUEST_MAX,
    normalizeSingleLine,
    PERSON_SEARCH_MAX,
    PERSON_SEARCH_MIN,
    PERSON_SEARCH_RESULTS,
    type InviteCandidateDto,
    type InviteCandidatesResponse,
  } from '@masl/shared';
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, ApiError } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import BottomAction from '#lib/components/BottomAction.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import Check from '#lib/components/icons/Check.svelte';
  import Search from '#lib/components/icons/Search.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Segmented from '#lib/components/wizard/Segmented.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { session } from '#lib/session.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { back } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { usePrimaryAction } from '#lib/tg/primary-action.svelte.js';

  type Filter = 'companions' | 'all';

  const SEARCH_DEBOUNCE_MS = 300;
  const STATE_NOTES: Record<Exclude<InviteCandidateDto['state'], 'available'>, string> = {
    invited: 'уже приглашение',
    going: 'уже участник',
    unavailable: 'нельзя пригласить',
  };

  const id = $derived(page.params.id ?? '');
  const lobby = $derived(lobbyCache.get(id)?.detail ?? lobbyCache.get(id)?.card);

  let filter = $state<Filter>('companions');
  let query = $state('');
  let companions = $state<InviteCandidatesResponse | null>(null);
  let found = $state<InviteCandidatesResponse | null>(null);
  let loadError = $state<string | null>(null);
  let forbidden = $state<string | null>(null);
  /** People picked across both tabs, by public code. */
  let picked = $state<Map<string, InviteCandidateDto>>(new Map());
  let sending = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Separate requests: typing a search must not cancel the companions list. */
  const controllers: Record<Filter, AbortController | null> = { companions: null, all: null };

  const searchText = $derived(normalizeSingleLine(query).slice(0, PERSON_SEARCH_MAX));
  const searching = $derived(searchText.length >= PERSON_SEARCH_MIN);
  const shown = $derived(filter === 'companions' ? companions : found);
  /** The latest answer's limits: places left and invites left today (null: no limit). */
  const limits = $derived(found ?? companions);
  const maxPick = $derived(Math.min(INVITES_PER_REQUEST_MAX, limits?.invitesLeft ?? INVITES_PER_REQUEST_MAX));

  onMount(() => {
    void lobbyCache.load(id).catch(() => undefined);
    void load('companions');
  });

  onDestroy(() => {
    clearTimeout(timer);
    controllers.companions?.abort();
    controllers.all?.abort();
  });

  function fail(error: unknown): void {
    if (error instanceof ApiError && error.status === 403) {
      forbidden = error.message;
      return;
    }
    const described = describeError(error);
    if (described.kind === 'update') toast.error(error);
    else loadError = described.text;
  }

  async function load(target: Filter, text?: string): Promise<void> {
    controllers[target]?.abort();
    const current = (controllers[target] = new AbortController());
    try {
      const response = await session.authorized((token) =>
        api.inviteCandidates(token, id, { filter: target, q: text }, current.signal),
      );
      if (target === 'companions') companions = response;
      else found = response;
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      fail(error);
    }
  }

  function oninput(): void {
    clearTimeout(timer);
    if (!searching) {
      found = null;
      controllers.all?.abort();
      return;
    }
    // Searches are limited per hour: the companions tab filters its own list instead.
    if (filter !== 'all') {
      found = null;
      return;
    }
    const text = searchText;
    timer = setTimeout(() => void load('all', text), SEARCH_DEBOUNCE_MS);
  }

  function switchFilter(next: Filter): void {
    filter = next;
    if (next === 'all' && searching && !found) void load('all', searchText);
  }

  /** Companions filtered by the typed text, on the client: their list is already here. */
  const visible = $derived.by(() => {
    if (filter === 'all') return searching ? (found?.items ?? null) : [];
    const items = companions?.items ?? null;
    if (!items || !searching) return items;
    const needle = searchText.toLowerCase().replace(/^@/, '');
    return items.filter((item) => item.person.firstName.toLowerCase().includes(needle));
  });

  function toggle(item: InviteCandidateDto): void {
    if (item.state !== 'available') return;
    const next = new Map(picked);
    if (next.has(item.person.code)) {
      next.delete(item.person.code);
    } else if (next.size >= maxPick) {
      haptic.warning();
      toast.show(
        maxPick === 0
          ? 'Лимит приглашений на сегодня исчерпан'
          : `За раз можно позвать до ${maxPick} человек`,
      );
      return;
    } else {
      next.set(item.person.code, item);
    }
    haptic.select();
    picked = next;
  }

  async function send(): Promise<void> {
    if (sending || picked.size === 0) return;
    sending = true;
    try {
      const result = await session.authorized((token) => api.sendInvites(token, id, [...picked.keys()]));
      haptic.success();
      toast.show(
        result.skipped > 0
          ? `Приглашения отправлены: ${result.sent}. Не смогли позвать: ${result.skipped}`
          : `Приглашения отправлены: ${result.sent}`,
        'success',
        4000,
      );
      picked = new Map();
      back.go();
    } catch (error) {
      toast.error(error);
      void load('companions');
      if (searching) void load('all', searchText);
    } finally {
      sending = false;
    }
  }

  const primary = usePrimaryAction(() => ({
    text: picked.size > 0 ? `Пригласить · ${picked.size}` : 'Пригласить',
    state: sending ? 'loading' : picked.size > 0 ? 'ready' : 'disabled',
    visible: forbidden === null,
    onClick: () => void send(),
  }));
</script>

<svelte:head>
  <title>Пригласить — MASL</title>
</svelte:head>

<main class="min-h-app pb-8">
  <PageHeader title="Пригласить" eyebrow={lobby?.title} />

  <div class="flex flex-col gap-4 px-5 pt-5">
    {#if forbidden}
      <EmptyState title="Пригласить нельзя" text={forbidden}>
        {#snippet actions()}
          <a href="/lobby/{id}" class="flex min-h-11 items-center rounded-2xl bg-gray-dark px-6">К встрече</a>
        {/snippet}
      </EmptyState>
    {:else}
      {#if lobby && !lobby.viewer.isHost}
        <p class="rounded-[1.125rem] border border-sand/50 bg-sand/10 p-3.5 text-sm leading-relaxed">
          Вы участник: после «Иду» придёт заявка, решает организатор.
        </p>
      {/if}

      <label class="relative block">
        <span class="sr-only">Имя или @username</span>
        <Search
          size={18}
          class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-light"
        />
        <input
          bind:value={query}
          type="search"
          autocomplete="off"
          enterkeyhint="search"
          maxlength={PERSON_SEARCH_MAX}
          placeholder="Имя или @username"
          class="min-h-12 w-full rounded-2xl border border-gray-dark bg-gray-dark/40 pr-4 pl-11 text-base text-paper placeholder:text-gray"
          {oninput}
        />
      </label>

      <Segmented
        options={[
          {
            value: 'companions',
            label: companions ? `Напарники · ${companions.items.length}` : 'Напарники',
          },
          { value: 'all', label: 'Все' },
        ]}
        value={filter}
        label="Кого показать"
        onchange={switchFilter}
      />

      {#if limits}
        <p class="text-[0.8125rem] text-gray-light">
          Свободно мест: {limits.freeSlots}{#if limits.invitesLeft !== null}
            · приглашений на сегодня: {limits.invitesLeft}{/if}
        </p>
      {/if}

      {#if loadError && !shown}
        <ErrorState
          title="Не удалось загрузить"
          message={loadError}
          onretry={() => void (filter === 'all' && searching ? load('all', searchText) : load('companions'))}
        />
      {:else if filter === 'all' && !searching}
        <p class="text-sm text-gray-light">
          Введите от {PERSON_SEARCH_MIN} символов имени или @username. В поиске нет тех, кто его отключил.
        </p>
      {:else if visible === null}
        <div class="flex flex-col gap-2" aria-busy="true">
          <div class="h-14 animate-pulse rounded-2xl bg-gray-dark/40"></div>
          <div class="h-14 animate-pulse rounded-2xl bg-gray-dark/40"></div>
        </div>
      {:else if visible.length === 0}
        <p class="text-sm text-gray-light">
          {filter === 'companions'
            ? searching
              ? 'Среди напарников никого не нашли'
              : 'Напарники появятся после встреч, где вас отметят вместе'
            : 'Никого не нашли'}
        </p>
      {:else}
        <ul class="flex flex-col gap-1.5" aria-label="Кого позвать">
          {#each visible as item (item.person.code)}
            {@const checked = picked.has(item.person.code)}
            {@const available = item.state === 'available'}
            <li>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-disabled={!available}
                class="flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 text-left {checked
                  ? 'border-brand bg-brand/15'
                  : 'border-gray-dark bg-gray-dark/30'} {available ? '' : 'opacity-60'}"
                onclick={() => toggle(item)}
              >
                <Avatar name={item.person.firstName} src={item.person.photoUrl} size={40} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">{item.person.firstName}</span>
                  {#if item.companion || !available}
                    <span class="text-[0.8125rem] text-gray-light">
                      {[
                        item.companion ? 'напарник' : null,
                        item.state === 'available' ? null : STATE_NOTES[item.state],
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  {/if}
                </span>
                {#if available}
                  <span
                    class="flex size-6 shrink-0 items-center justify-center rounded-full border {checked
                      ? 'border-brand bg-brand'
                      : 'border-gray'}"
                    aria-hidden="true"
                  >
                    {#if checked}<Check size={14} strokeWidth={2.6} />{/if}
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if filter === 'all' && visible.length >= PERSON_SEARCH_RESULTS}
          <p class="text-[0.8125rem] text-gray-light">
            Показаны первые {PERSON_SEARCH_RESULTS} совпадений. Уточните имя или введите @username.
          </p>
        {/if}
      {/if}
    {/if}
  </div>

  {#if primary.fallback}
    <BottomAction {...primary.fallback} />
  {/if}
</main>
