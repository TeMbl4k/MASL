<script lang="ts">
  import type { CreationContextDto, PrivacyInput, PublicProfileDto } from '@masl/shared';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import CreationBlockCard from '#lib/components/CreationBlockCard.svelte';
  import ChevronRight from '#lib/components/icons/ChevronRight.svelte';
  import InterestsSheet from '#lib/components/InterestsSheet.svelte';
  import KarmaCard from '#lib/components/KarmaCard.svelte';
  import KarmaHistory from '#lib/components/KarmaHistory.svelte';
  import PersonStats from '#lib/components/PersonStats.svelte';
  import ShareSheet from '#lib/components/ShareSheet.svelte';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';

  // Tab roots render only for a ready, onboarded session (root layout).
  const user = $derived(session.state.status === 'ready' ? session.state.user : null);
  const interests = $derived(
    user ? session.interests.filter((interest) => user.interests.includes(interest.slug)) : [],
  );

  let creation = $state<CreationContextDto | null>(null);
  /** The numbers others see on the public profile. */
  let publicProfile = $state<PublicProfileDto | null>(null);
  let savingPrivacy = $state(false);
  let metroAttribution = $state<string | null>(null);

  onMount(() => {
    // The numbers are an extra: a failure just leaves them out.
    if (user) {
      const code = user.publicCode;
      session
        .authorized((token) => api.person(token, code))
        .then(
          (profile) => (publicProfile = profile),
          () => undefined,
        );
    }
    // Only the «приостановлено» note depends on it: a failure just leaves it out.
    session
      .authorized((token) => api.creationContext(token))
      .then(
        (context) => (creation = context),
        () => undefined,
      );
    // The metro module carries the station dataset: loaded apart from the screen.
    import('@masl/shared/metro').then(
      (metro) => (metroAttribution = metro.METRO_ATTRIBUTION),
      () => undefined,
    );
  });

  async function setPrivacy(change: Partial<PrivacyInput>): Promise<void> {
    if (!user || savingPrivacy) return;
    savingPrivacy = true;
    haptic.select();
    const input = { hideFromSearch: user.hideFromSearch, invitesEnabled: user.invitesEnabled, ...change };
    try {
      session.setUser(await session.authorized((token) => api.updatePrivacy(token, input)));
    } catch (error) {
      toast.error(error);
    } finally {
      savingPrivacy = false;
    }
  }
</script>

<svelte:head>
  <title>Профиль — MASL</title>
</svelte:head>

<main class="min-h-app px-5 pt-7">
  {#if user}
    <div class="flex flex-col gap-5">
      <header class="flex items-center gap-4">
        <Avatar name={user.firstName} src={user.photoUrl} size={72} ring />
        <div class="flex min-w-0 flex-col gap-1">
          <h1 tabindex="-1" class="text-[1.625rem] leading-tight font-light break-words outline-none">
            {user.firstName}{#if user.age !== null},
              <span class="font-semibold italic">{user.age}</span>{/if}
          </h1>
        </div>
      </header>

      {#if publicProfile}
        <PersonStats
          hosted={publicProfile.hosted}
          attended={publicProfile.attended}
          companions={publicProfile.companions}
          companionsHref="/profile/companions"
        />
      {/if}

      {#if creation?.reason === 'blocked'}
        <CreationBlockCard />
      {/if}

      {#if user.role !== 'user'}
        <a
          href="/admin"
          class="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4"
        >
          <span class="font-semibold">Модерация</span>
          <span class="flex items-center gap-2">
            {#if user.moderationQueue}
              <span
                class="rounded-full bg-brand px-2.5 py-0.5 text-sm font-bold"
                aria-label="Открытых дел: {user.moderationQueue}">{user.moderationQueue}</span
              >
            {/if}
            <ChevronRight size={20} class="text-gray-light" />
          </span>
        </a>
      {/if}

      <KarmaCard karma={user.karma} />

      <section class="flex flex-col gap-3" aria-labelledby="profile-interests">
        <div class="flex items-center justify-between gap-3">
          <h2 id="profile-interests" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
            Интересы
          </h2>
          <button
            type="button"
            class="min-h-11 rounded-full border border-gray-dark px-4 text-sm"
            onclick={() => openSheet('interests')}
          >
            Изменить
          </button>
        </div>
        {#if interests.length > 0}
          <ul class="flex flex-wrap gap-2">
            {#each interests as interest (interest.slug)}
              <li class="rounded-full border border-brand bg-brand/20 px-3.5 py-2 text-sm">
                {interest.emoji}
                {interest.title}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-gray-light">Интересы не выбраны</p>
        {/if}
      </section>

      <KarmaHistory />

      <button
        type="button"
        class="min-h-12 rounded-2xl border border-gray-dark text-[0.9375rem]"
        onclick={() => void openSheet('share')}
      >
        Поделиться профилем
      </button>

      <section class="flex flex-col gap-2" aria-labelledby="profile-privacy">
        <h2 id="profile-privacy" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
          Приватность
        </h2>
        {@render toggle(
          'Показывать меня в поиске',
          'Найти по имени и пригласить вас смогут все. Напарники видят вас всегда.',
          !user.hideFromSearch,
          () => void setPrivacy({ hideFromSearch: !user.hideFromSearch }),
        )}
        {@render toggle(
          'Приглашения на встречи',
          'Если выключить, пригласить вас не сможет никто.',
          user.invitesEnabled,
          () => void setPrivacy({ invitesEnabled: !user.invitesEnabled }),
        )}
      </section>

      <a
        href="/feedback"
        class="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4"
      >
        <span>Написать нам</span>
        <ChevronRight size={20} class="text-gray-light" />
      </a>

      <a
        href="/terms"
        class="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4"
      >
        <span>Пользовательское соглашение</span>
        <ChevronRight size={20} class="text-gray-light" />
      </a>

      <footer class="flex flex-col gap-1 pt-4 pb-2 text-xs text-gray">
        <!-- Plain text: a link would navigate the Mini App's webview away. -->
        <p>Карта: OpenFreeMap · © OpenStreetMap</p>
        {#if metroAttribution}
          <p>{metroAttribution}</p>
        {/if}
      </footer>
    </div>
  {/if}
</main>

<InterestsSheet />
{#if user}
  {@const me = user}
  <ShareSheet input={{ kind: 'profile', code: me.publicCode }} title="Поделиться профилем">
    {#snippet preview()}
      <div class="flex items-center gap-3 rounded-2xl border border-gray-dark bg-ink/60 p-4">
        <Avatar name={me.firstName} src={me.photoUrl} size={44} />
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-semibold">{me.firstName} в MASL</span>
          <span class="text-sm text-gray-light">Карма {me.karma}</span>
        </div>
      </div>
    {/snippet}
  </ShareSheet>
{/if}

{#snippet toggle(title: string, hint: string, on: boolean, onclick: () => void)}
  <button
    type="button"
    role="switch"
    aria-checked={on}
    class="flex min-h-14 items-center gap-3 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-3 text-left disabled:opacity-60"
    disabled={savingPrivacy}
    {onclick}
  >
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span>{title}</span>
      <span class="text-[0.8125rem] text-gray-light">{hint}</span>
    </span>
    <span
      class="relative h-7 w-12 shrink-0 rounded-full transition {on ? 'bg-brand' : 'bg-gray-dark'}"
      aria-hidden="true"
    >
      <span class="absolute top-1 size-5 rounded-full bg-paper transition-all {on ? 'left-6' : 'left-1'}"
      ></span>
    </span>
  </button>
{/snippet}
