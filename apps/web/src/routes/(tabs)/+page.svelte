<script lang="ts">
  import { asDate, FEED_SOON_HOURS, HOUR_MS, LOBBY_CATEGORY_INFO, type LobbyCardDto } from '@masl/shared';
  import { untrack } from 'svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import CategoryChips from '#lib/components/CategoryChips.svelte';
  import DayStrip from '#lib/components/DayStrip.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import ChevronDown from '#lib/components/icons/ChevronDown.svelte';
  import Pin from '#lib/components/icons/Pin.svelte';
  import KarmaBadge from '#lib/components/KarmaBadge.svelte';
  import LobbyCard from '#lib/components/LobbyCard.svelte';
  import LobbyCardSkeleton from '#lib/components/LobbyCardSkeleton.svelte';
  import OriginSheet from '#lib/components/OriginSheet.svelte';
  import { minKarmaMet } from '#lib/lobby-card.js';
  import { session } from '#lib/session.svelte.js';
  import { clock, useRefreshWhenActive } from '#lib/stores/clock.svelte.js';
  import { feed } from '#lib/stores/feed.svelte.js';
  import { filters } from '#lib/stores/filters.svelte.js';
  import { origin } from '#lib/stores/origin.svelte.js';
  import { openSheet } from '#lib/tg/back.svelte.js';

  const user = $derived(session.state.status === 'ready' ? session.state.user : null);

  let originSheet = $state<ReturnType<typeof OriginSheet> | null>(null);
  let sentinel = $state<HTMLElement | null>(null);

  // A derived only changes when the query does, so clock ticks don't re-run the effect.
  const queryKey = $derived(JSON.stringify(feed.query));
  $effect(() => {
    void queryKey;
    untrack(() => void feed.ensure());
  });
  useRefreshWhenActive(() => void feed.ensure());

  // Next page when the end of the list comes into view. Re-observing after each new page fires
  // again if the end is still in view (a short page); a failed page waits for the next scroll.
  $effect(() => {
    void feed.items.length;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void feed.loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  /**
   * The first card is featured when it starts soon and the viewer can join it: a locked badge
   * would sit in grey on the orange gradient.
   */
  function variantOf(lobby: LobbyCardDto, index: number): 'featured' | 'default' {
    if (index !== 0 || !minKarmaMet(lobby, user?.karma ?? null)) return 'default';
    const soon = asDate(lobby.startsAt).getTime() - clock.now <= FEED_SOON_HOURS * HOUR_MS;
    return soon ? 'featured' : 'default';
  }

  const firstLoad = $derived(
    feed.items.length === 0 && (feed.status === 'loading' || feed.status === 'idle'),
  );
  const categoryTitle = $derived(filters.category ? LOBBY_CATEGORY_INFO[filters.category].title : null);
</script>

<svelte:head>
  <title>Для вас — MASL</title>
</svelte:head>

{#snippet createLink()}
  <a href="/create" class="flex min-h-11 items-center rounded-2xl bg-brand px-5 font-bold text-paper">
    Создать встречу
  </a>
{/snippet}

<main class="bg-brand-glow min-h-app">
  <header class="flex flex-col gap-4 px-5 pt-5">
    <div class="flex items-center gap-3">
      {#if user}
        <Avatar name={user.firstName} src={user.photoUrl} size={44} ring />
      {/if}
      <div class="min-w-0 flex-1">
        <h1 tabindex="-1" class="truncate text-lg font-semibold outline-none">
          Привет, {user?.firstName ?? ''}
        </h1>
        <p class="text-[0.8125rem] text-gray-light">Куда пойдём сегодня?</p>
      </div>
      {#if user}
        <KarmaBadge karma={user.karma} variant="pill" href="/profile" />
      {/if}
    </div>

    <button
      type="button"
      class="flex min-h-11 items-center gap-2 self-start rounded-full border border-gray-dark bg-gray-dark/45 px-3.5 text-sm"
      aria-label="Откуда считать расстояние: {origin.label ?? 'Вся Москва'}"
      onclick={() => void openSheet('origin')}
    >
      <Pin size={18} class="text-brand" />
      {origin.label ?? 'Вся Москва'}
      <ChevronDown size={16} class="text-gray-light" />
    </button>

    {#if origin.current === null && !origin.silentLocating && feed.status !== 'idle'}
      <section class="flex flex-col gap-3 rounded-3xl border border-gray-dark bg-ink/60 p-4">
        <h2 class="font-semibold">Покажем встречи рядом</h2>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="min-h-11 rounded-xl bg-brand px-4 font-semibold text-paper disabled:opacity-60"
            disabled={origin.locating}
            onclick={() => void originSheet?.locate()}
          >
            {origin.locating ? 'Определяем…' : 'Разрешить геолокацию'}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-xl bg-gray-dark px-4 text-paper"
            onclick={() => void originSheet?.pickStation()}
          >
            Выбрать метро
          </button>
          <button type="button" class="min-h-11 px-2 text-gray-light" onclick={() => origin.useWholeCity()}>
            Не сейчас
          </button>
        </div>
      </section>
    {:else if origin.outsideMoscow}
      <p class="text-sm text-gray-light">Вы далеко от Москвы — показываем встречи по всему городу</p>
    {/if}

    <CategoryChips bind:value={filters.category} />
    <DayStrip bind:value={filters.day} days={feed.days} />
  </header>

  <section
    class="flex flex-col gap-3.5 px-5 pt-[1.125rem]"
    aria-busy={feed.status === 'loading'}
    aria-label="Встречи"
  >
    {#if firstLoad}
      {#each [0, 1, 2] as i (i)}
        <LobbyCardSkeleton />
      {/each}
    {:else if feed.items.length === 0 && feed.status === 'error'}
      <ErrorState
        title="Не удалось загрузить встречи"
        message={feed.error}
        onretry={() => void feed.refresh()}
      />
    {:else if feed.items.length === 0}
      {#if categoryTitle}
        <EmptyState title="В категории «{categoryTitle}» пока пусто">
          {#snippet actions()}
            <button
              type="button"
              class="min-h-11 rounded-2xl bg-gray-dark px-5 text-paper"
              onclick={() => (filters.category = null)}
            >
              Показать все
            </button>
            {@render createLink()}
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          title="Пока тихо"
          text="{filters.day
            ? 'Встреч на этот день ещё нет.'
            : 'Встреч пока нет.'} Создайте свою — компания находится быстрее, чем кажется."
          actions={createLink}
        />
      {/if}
    {:else}
      {#if feed.status === 'error'}
        <div class="flex items-center justify-between gap-3 text-sm text-gray-light" role="alert">
          <span>Не удалось обновить ленту</span>
          <button type="button" class="min-h-11 px-2 text-brand" onclick={() => void feed.refresh()}>
            Обновить
          </button>
        </div>
      {/if}
      {#each feed.items as lobby, index (lobby.id)}
        <LobbyCard {lobby} variant={variantOf(lobby, index)} />
      {/each}
      {#if feed.loadingMore}
        <LobbyCardSkeleton />
      {/if}
      {#if feed.nextCursor}
        <div bind:this={sentinel} class="h-px" aria-hidden="true"></div>
      {/if}
    {/if}
  </section>
</main>

<OriginSheet bind:this={originSheet} />
