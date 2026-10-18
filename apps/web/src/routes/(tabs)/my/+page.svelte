<script lang="ts">
  import type { LobbyBucketDto, LobbyCardDto } from '@masl/shared';
  import { onMount, tick } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import ChevronDown from '#lib/components/icons/ChevronDown.svelte';
  import ChevronRight from '#lib/components/icons/ChevronRight.svelte';
  import LobbyCard from '#lib/components/LobbyCard.svelte';
  import LobbyCardSkeleton from '#lib/components/LobbyCardSkeleton.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Segmented from '#lib/components/wizard/Segmented.svelte';
  import { NEW_APPLICATION_FORMS, plural } from '#lib/format/plural.js';
  import { myLobbies } from '#lib/stores/my-lobbies.svelte.js';

  type Tab = 'hosting' | 'joined';

  /** How long a just-published card glows. */
  const GLOW_MS = 1500;

  const param = $derived(page.url.searchParams.get('tab'));
  /** Without `?tab=`: «Организую», unless only «Участвую» has upcoming lobbies. */
  const tab = $derived<Tab>(
    param === 'hosting' || param === 'joined'
      ? param
      : myLobbies.hosting.upcoming.length === 0 && myLobbies.joined.upcoming.length > 0
        ? 'joined'
        : 'hosting',
  );
  const bucket = $derived<LobbyBucketDto>(tab === 'hosting' ? myLobbies.hosting : myLobbies.joined);
  /** Past hosted lobbies waiting for «Кто пришёл», shown above the upcoming ones. */
  const attendanceDue = $derived(
    tab === 'hosting'
      ? myLobbies.hosting.past.filter((lobby) => myLobbies.attendanceDue.includes(lobby.id))
      : [],
  );

  /** «Организую · 2»; the count only once the list is loaded. */
  const label = (title: string, count: number) =>
    myLobbies.status === 'ready' ? `${title} · ${count}` : title;
  const options = $derived([
    { value: 'hosting' as const, label: label('Организую', myLobbies.hosting.upcoming.length) },
    { value: 'joined' as const, label: label('Участвую', myLobbies.joined.upcoming.length) },
  ]);

  let pastOpen = $state(false);
  let glowId = $state<string | null>(null);

  function switchTab(next: Tab) {
    pastOpen = false;
    glowId = null;
    // Replaced, not pushed: the tabs are one screen and BackButton must not walk through them.
    void goto(`?tab=${next}`, { replace: true, reset: false });
  }

  onMount(() => {
    const created = page.url.searchParams.get('new');
    const loaded = myLobbies.ensure();
    if (!created || prefersReducedMotion.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The list may still be loading: the glow starts once the card is there.
    void loaded.then(async () => {
      if (!myLobbies.hosting.upcoming.some((lobby) => lobby.id === created)) return;
      glowId = created;
      await tick();
      document.getElementById(`lobby-${created}`)?.scrollIntoView({ block: 'nearest' });
      timer = setTimeout(() => (glowId = null), GLOW_MS);
    });
    return () => clearTimeout(timer);
  });

  const hasPending = (lobby: LobbyCardDto) => lobby.status === 'open' && (lobby.pendingCount ?? 0) > 0;
</script>

<svelte:head>
  <title>Мои события — MASL</title>
</svelte:head>

{#snippet card(lobby: LobbyCardDto, featured: boolean)}
  {#snippet pending()}
    <a
      href="/lobby/{lobby.id}/manage"
      class="flex min-h-12 items-center justify-between gap-2 px-[1.125rem] text-[0.9375rem] font-semibold"
    >
      {plural(lobby.pendingCount ?? 0, NEW_APPLICATION_FORMS)}
      <ChevronRight size={18} />
    </a>
  {/snippet}
  <li id="lobby-{lobby.id}" class="scroll-my-4">
    <LobbyCard
      {lobby}
      variant={featured ? 'featured' : 'default'}
      glow={glowId === lobby.id}
      footer={tab === 'hosting' && hasPending(lobby) ? pending : undefined}
    />
  </li>
{/snippet}

<main class="bg-brand-glow min-h-dvh">
  <PageHeader title="Мои события">
    {#snippet heading()}Мои <span class="font-semibold italic">события</span>{/snippet}
  </PageHeader>
  <div class="mt-5 flex flex-col gap-4 px-5">
    <Segmented {options} value={tab} label="Раздел" onchange={switchTab} />

    {#if myLobbies.status === 'idle' || myLobbies.status === 'loading'}
      <div class="flex flex-col gap-3" aria-busy="true">
        <span class="sr-only">Загружаем встречи…</span>
        <LobbyCardSkeleton />
        <LobbyCardSkeleton />
        <LobbyCardSkeleton />
      </div>
    {:else if myLobbies.status === 'error'}
      <ErrorState
        title="Не удалось загрузить встречи"
        message={myLobbies.error}
        onretry={() => void myLobbies.ensure()}
      />
    {:else}
      {#if attendanceDue.length > 0}
        <ul class="flex flex-col gap-3" aria-label="Ждут отметки, кто пришёл">
          {#each attendanceDue as lobby (lobby.id)}
            {#snippet mark()}
              <a
                href="/lobby/{lobby.id}/attendance"
                class="flex min-h-12 items-center justify-between gap-2 px-[1.125rem] text-[0.9375rem] font-semibold"
              >
                Отметьте, кто пришёл
                <ChevronRight size={18} />
              </a>
            {/snippet}
            <li><LobbyCard {lobby} footer={mark} /></li>
          {/each}
        </ul>
      {/if}
      {#if bucket.upcoming.length > 0}
        <ul class="flex flex-col gap-3" aria-label="Предстоящие">
          {#each bucket.upcoming as lobby, index (lobby.id)}
            <!-- The host's nearest lobby stands out, as in the feed. -->
            {@render card(lobby, tab === 'hosting' && index === 0)}
          {/each}
        </ul>
      {:else if tab === 'hosting'}
        <EmptyState
          title={bucket.past.length > 0 ? 'Предстоящих встреч нет' : 'Вы ещё не создавали встреч'}
          text="Соберите компанию на сегодня или завтра — так находятся быстрее."
        >
          {#snippet actions()}
            <a href="/create" class="flex min-h-11 items-center rounded-2xl bg-brand px-6 text-lg font-bold">
              Создать встречу
            </a>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          title={bucket.past.length > 0 ? 'Предстоящих встреч нет' : 'Вы пока никуда не записались'}
          text="В ленте — встречи на сегодня и ближайшие дни."
        >
          {#snippet actions()}
            <a href="/" class="flex min-h-11 items-center rounded-2xl bg-brand px-6 text-lg font-bold">
              Найти встречу
            </a>
          {/snippet}
        </EmptyState>
      {/if}

      {#if bucket.past.length > 0}
        <button
          type="button"
          aria-expanded={pastOpen}
          aria-controls="my-past"
          class="flex min-h-12 items-center justify-between gap-2 rounded-2xl border border-gray-dark px-4 text-left text-[0.9375rem] text-gray-light"
          onclick={() => (pastOpen = !pastOpen)}
        >
          Прошедшие и отменённые · {bucket.past.length}
          <ChevronDown size={18} class="transition-transform {pastOpen ? 'rotate-180' : ''}" />
        </button>
        {#if pastOpen}
          <ul id="my-past" class="flex flex-col gap-3 opacity-80" aria-label="Прошедшие и отменённые">
            {#each bucket.past as lobby (lobby.id)}
              <li><LobbyCard {lobby} /></li>
            {/each}
          </ul>
        {/if}
      {/if}
    {/if}
  </div>
</main>
