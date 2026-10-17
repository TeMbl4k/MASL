<script lang="ts">
  import './layout.css';
  import { onMount } from 'svelte';
  import favicon from '#lib/assets/favicon.svg';
  import Onboarding from '#lib/components/Onboarding.svelte';
  import { session } from '#lib/session.svelte.js';
  import { mountTelegramUi } from '#lib/tg/index.js';
  import { useBackController } from '#lib/tg/back.svelte.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  useBackController();

  onMount(() => {
    void session.start();
  });

  $effect(() => {
    if (session.state.status === 'ready') void mountTelegramUi();
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>MASL</title>
</svelte:head>

{#if session.state.status === 'loading'}
  <main class="bg-brand-glow flex min-h-dvh items-center justify-center">
    <p class="text-gray-light">Загружаем…</p>
  </main>
{:else if session.state.status === 'outside-telegram'}
  <main class="bg-brand-glow flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
    <h1 class="text-2xl font-semibold">Откройте приложение в Telegram</h1>
    <p class="text-gray-light">MASL работает как Mini App: запустите его через нашего бота.</p>
  </main>
{:else if session.state.status === 'error'}
  <main class="bg-brand-glow flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
    <p>{session.state.message}</p>
    <button class="rounded-2xl bg-brand px-6 py-3 text-xl font-bold" onclick={() => session.start()}>
      Повторить
    </button>
  </main>
{:else if !session.state.user.onboarded}
  <Onboarding
    user={session.state.user}
    interests={session.interests}
    onSubmit={(input) => session.completeOnboarding(input)}
  />
{:else}
  {@render children()}
{/if}
