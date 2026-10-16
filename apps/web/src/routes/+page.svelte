<script lang="ts">
  import { onMount } from 'svelte';
  import Onboarding from '#lib/components/Onboarding.svelte';
  import { session } from '#lib/session.svelte.js';

  onMount(() => {
    void session.start();
  });
</script>

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
  <main class="bg-brand-glow flex min-h-dvh flex-col gap-6 px-5 pt-14">
    <header class="flex items-center gap-3">
      {#if session.state.user.photoUrl}
        <img
          src={session.state.user.photoUrl}
          alt=""
          class="size-12 rounded-full border-2 border-brand object-cover"
        />
      {/if}
      <div>
        <p class="text-lg font-semibold">Привет, {session.state.user.firstName}</p>
        <p class="text-sm text-gray-light">Карма: {session.state.user.karma}</p>
      </div>
    </header>
    <section class="rounded-3xl border border-gray-dark bg-gray-dark/40 p-6">
      <h2 class="text-xl font-semibold">Скоро здесь появятся встречи рядом</h2>
      <p class="mt-2 text-gray-light">Мы собираем ленту «Для вас» по вашим интересам.</p>
    </section>
  </main>
{/if}
