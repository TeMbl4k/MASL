<!-- Full screen shown when a response no longer matches the app (a deploy while it stayed open). -->
<main
  class="bg-brand-glow fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 px-8 text-center"
>
  <h1 tabindex="-1" class="text-2xl font-semibold outline-none">Приложение обновилось</h1>
  <p class="text-gray-light">Перезапустите его, чтобы продолжить.</p>
  <button
    type="button"
    class="rounded-2xl bg-brand px-6 py-3 text-xl font-bold text-paper"
    onclick={() => location.reload()}
  >
    Обновить
  </button>
</main>
