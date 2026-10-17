<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status === 404 ? 'Страница не найдена' : 'Ошибка'} — MASL</title>
</svelte:head>

<main class="bg-brand-glow flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
  <h1 tabindex="-1" class="text-2xl font-semibold outline-none">
    {page.status === 404 ? 'Страница не найдена' : 'Что-то пошло не так'}
  </h1>
  <a href="/" class="rounded-2xl bg-brand px-6 py-3 text-xl font-bold text-paper">На главную</a>
</main>
