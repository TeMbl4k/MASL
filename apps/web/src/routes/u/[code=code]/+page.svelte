<script lang="ts">
  import type { PublicProfileDto } from '@masl/shared';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { api, ApiError } from '#lib/api.js';
  import AchievementBadges from '#lib/components/achievements/AchievementBadges.svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import KarmaBadge from '#lib/components/KarmaBadge.svelte';
  import LobbyCard from '#lib/components/LobbyCard.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import PersonStats from '#lib/components/PersonStats.svelte';
  import ShareSheet from '#lib/components/ShareSheet.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity } from '#lib/stores/clock.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { openSheet } from '#lib/tg/back.svelte.js';

  const code = $derived(page.params.code ?? '');

  let person = $state<PublicProfileDto | null>(null);
  let notFound = $state(false);
  let loadError = $state<string | null>(null);
  let controller: AbortController | null = null;

  const interests = $derived(
    person ? session.interests.filter((interest) => person!.interests.includes(interest.slug)) : [],
  );

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      const next = await session.authorized((token) => api.person(token, code, current.signal));
      next.lobbies.forEach((card) => lobbyCache.prime(card));
      person = next;
      notFound = false;
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && error.status === 404) {
        notFound = true;
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update' || person) toast.error(error);
      else loadError = shown.text;
    }
  }

  $effect(() => {
    void code;
    if (appActivity.active) untrack(() => void load());
  });
</script>

<svelte:head>
  <title>{person?.firstName ?? 'Профиль'} — MASL</title>
</svelte:head>

<main class="bg-brand-glow min-h-app pb-10">
  {#if notFound}
    <PageHeader title="Профиль не найден" />
    <div class="flex flex-col items-start gap-4 px-5 pt-4">
      <p class="text-gray-light">Возможно, ссылка устарела.</p>
      <a href="/" class="rounded-2xl bg-brand px-6 py-3 text-lg font-bold text-paper">На главную</a>
    </div>
  {:else if !person}
    <PageHeader title="Профиль" />
    <div class="flex flex-col gap-4 px-5 pt-4">
      {#if loadError}
        <ErrorState title="Не удалось загрузить профиль" message={loadError} onretry={() => void load()} />
      {:else}
        <div class="h-24 animate-pulse rounded-3xl bg-gray-dark/40" aria-busy="true"></div>
        <div class="h-20 animate-pulse rounded-3xl bg-gray-dark/40"></div>
      {/if}
    </div>
  {:else}
    {@const shown = person}
    <PageHeader title={shown.firstName} eyebrow={shown.isSelf ? 'Так вас видят другие' : 'Профиль'} />
    <div class="flex flex-col gap-5 px-5 pt-5">
      <div class="flex items-center gap-4">
        <Avatar name={shown.firstName} src={shown.photoUrl} size={72} ring />
        <div class="flex flex-col items-start gap-2">
          <KarmaBadge karma={shown.karma} variant="pill" />
          {#if shown.isCompanion}
            <span class="rounded-full bg-brand/20 px-3 py-1 text-[0.8125rem]">Ваш напарник</span>
          {/if}
        </div>
      </div>

      <PersonStats
        hosted={shown.hosted}
        attended={shown.attended}
        companions={shown.companions}
        companionsHref={shown.isSelf ? '/profile/companions' : undefined}
      />

      {#if shown.achievements.length > 0}
        <AchievementBadges items={shown.achievements} />
      {/if}

      {#if interests.length > 0}
        <section class="flex flex-col gap-3" aria-labelledby="person-interests">
          <h2 id="person-interests" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
            Интересы
          </h2>
          <ul class="flex flex-wrap gap-2">
            {#each interests as interest (interest.slug)}
              <li class="rounded-full border border-gray-dark bg-gray-dark/40 px-3.5 py-2 text-sm">
                {interest.emoji}
                {interest.title}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="flex flex-col gap-3" aria-labelledby="person-lobbies">
        <h2 id="person-lobbies" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
          Ближайшие встречи
        </h2>
        {#if shown.lobbies.length > 0}
          <ul class="flex flex-col gap-3">
            {#each shown.lobbies as lobby (lobby.id)}
              <li><LobbyCard {lobby} /></li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-gray-light">Открытых встреч сейчас нет</p>
        {/if}
      </section>

      <button
        type="button"
        class="min-h-12 rounded-2xl border border-gray-dark text-[0.9375rem]"
        onclick={() => void openSheet('share')}
      >
        Поделиться профилем
      </button>
    </div>

    <ShareSheet input={{ kind: 'profile', code: shown.code }} title="Поделиться профилем">
      {#snippet preview()}
        <div class="flex items-center gap-3 rounded-2xl border border-gray-dark bg-ink/60 p-4">
          <Avatar name={shown.firstName} src={shown.photoUrl} size={44} />
          <div class="flex min-w-0 flex-col">
            <span class="truncate font-semibold">{shown.firstName} в MASL</span>
            <span class="text-sm text-gray-light">Карма {shown.karma}</span>
          </div>
        </div>
      {/snippet}
    </ShareSheet>
  {/if}
</main>
