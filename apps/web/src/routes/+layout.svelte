<script lang="ts">
  import './layout.css';
  import { TERMS_VERSION } from '@masl/shared';
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import favicon from '#lib/assets/favicon.svg';
  import AppUpdated from '#lib/components/AppUpdated.svelte';
  import Onboarding from '#lib/components/Onboarding.svelte';
  import TermsAcceptance from '#lib/components/TermsAcceptance.svelte';
  import Toasts from '#lib/components/Toasts.svelte';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { mountTelegramUi } from '#lib/tg/index.js';
  import { useBackController } from '#lib/tg/back.svelte.js';
  import { isReload, launchStartParam, startParamPath } from '#lib/tg/start-param.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  useBackController();

  onMount(() => {
    void session.start();
  });

  $effect(() => {
    if (session.state.status === 'ready') void mountTelegramUi();
  });

  /** The t.me link the app was opened with: counted as the source, then its page opened once. */
  let arrivalSent = false;
  let startOpened = false;

  $effect(() => {
    if (session.state.status !== 'ready') return;
    const { termsAccepted, onboarded } = session.state.user;
    untrack(() => {
      const startParam = launchStartParam();
      if (!startParam) return;
      if (!arrivalSent) {
        arrivalSent = true;
        // Only statistics depend on it: a failure is not shown.
        session.authorized((token) => api.arrival(token, startParam)).catch(() => undefined);
      }
      // The page opens after the agreement and onboarding, over the feed the app started on.
      if (startOpened || !termsAccepted || !onboarded) return;
      startOpened = true;
      const path = startParamPath(startParam);
      if (path && page.url.pathname === '/' && !isReload()) void goto(path);
    });
  });

  async function acceptTerms() {
    session.setUser(await session.authorized((token) => api.acceptTerms(token, TERMS_VERSION)));
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>MASL</title>
</svelte:head>

{#if session.state.status === 'loading'}
  <main class="bg-brand-glow flex min-h-app items-center justify-center">
    <p class="text-gray-light">Загружаем…</p>
  </main>
{:else if session.state.status === 'outside-telegram'}
  <main class="bg-brand-glow flex min-h-app flex-col items-center justify-center gap-3 px-8 text-center">
    <h1 class="text-2xl font-semibold">Откройте приложение в Telegram</h1>
    <p class="text-gray-light">MASL работает как Mini App: запустите его через нашего бота.</p>
  </main>
{:else if session.state.status === 'error'}
  <main class="bg-brand-glow flex min-h-app flex-col items-center justify-center gap-4 px-8 text-center">
    <p>{session.state.message}</p>
    <button class="rounded-2xl bg-brand px-6 py-3 text-xl font-bold" onclick={() => session.start()}>
      Повторить
    </button>
  </main>
{:else if !session.state.user.termsAccepted}
  <TermsAcceptance user={session.state.user} onAccept={acceptTerms} />
{:else if !session.state.user.onboarded}
  <Onboarding
    user={session.state.user}
    interests={session.interests}
    onSubmit={(input) => session.completeOnboarding(input)}
  />
{:else if toast.updateRequired}
  <AppUpdated />
{:else}
  {@render children()}
{/if}

<Toasts />
