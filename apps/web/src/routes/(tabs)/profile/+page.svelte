<script lang="ts">
  import { CREATION_BLOCKED_TITLE, type CreationContextDto } from '@masl/shared';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import Alert from '#lib/components/icons/Alert.svelte';
  import InterestsSheet from '#lib/components/InterestsSheet.svelte';
  import KarmaCard from '#lib/components/KarmaCard.svelte';
  import KarmaHistory from '#lib/components/KarmaHistory.svelte';
  import { session } from '#lib/session.svelte.js';
  import { myLobbies } from '#lib/stores/my-lobbies.svelte.js';
  import { openSheet } from '#lib/tg/back.svelte.js';

  // Tab roots render only for a ready, onboarded session (root layout).
  const user = $derived(session.state.status === 'ready' ? session.state.user : null);
  const interests = $derived(
    user ? session.interests.filter((interest) => user.interests.includes(interest.slug)) : [],
  );

  let creation = $state<CreationContextDto | null>(null);
  let metroAttribution = $state<string | null>(null);

  onMount(() => {
    void myLobbies.ensure();
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
</script>

<svelte:head>
  <title>Профиль — MASL</title>
</svelte:head>

<main class="min-h-dvh px-5 pt-7">
  {#if user}
    <div class="flex flex-col gap-5">
      <header class="flex items-center gap-4">
        <Avatar name={user.firstName} src={user.photoUrl} size={72} ring />
        <div class="flex min-w-0 flex-col gap-1">
          <h1 tabindex="-1" class="text-[1.625rem] leading-tight font-light break-words outline-none">
            {user.firstName}{#if user.age !== null},
              <span class="font-semibold italic">{user.age}</span>{/if}
          </h1>
          {#if myLobbies.status === 'ready'}
            <p class="text-sm text-gray-light">
              Организовано: {myLobbies.counts.hosted} · Участий: {myLobbies.counts.joined}
            </p>
          {/if}
        </div>
      </header>

      {#if creation?.reason === 'blocked'}
        <p
          class="flex items-center gap-2 rounded-2xl border border-brand-light/60 bg-brand-deep/10 px-4 py-3 text-sm"
          role="status"
        >
          <Alert size={18} class="shrink-0 text-brand-light" />
          {CREATION_BLOCKED_TITLE}
        </p>
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
