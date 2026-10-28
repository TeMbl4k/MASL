<script lang="ts">
  import {
    SUPPORT_CATEGORIES,
    SUPPORT_CATEGORY_LABELS,
    SUPPORT_TEXT_MAX,
    SUPPORT_TEXT_MIN,
    type SupportCategory,
  } from '@masl/shared';
  import { api } from '#lib/api.js';
  import BottomAction from '#lib/components/BottomAction.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { back } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { usePrimaryAction } from '#lib/tg/primary-action.svelte.js';
  import { askWriteAccess } from '#lib/tg/write-access.js';

  let category = $state<SupportCategory | null>(null);
  let text = $state('');
  let busy = $state(false);

  const length = $derived(text.trim().length);
  const complete = $derived(category !== null && length >= SUPPORT_TEXT_MIN && length <= SUPPORT_TEXT_MAX);

  async function submit(): Promise<void> {
    if (busy) return;
    if (!complete || !category) {
      haptic.warning();
      toast.show(
        category ? `Напишите подробнее: от ${SUPPORT_TEXT_MIN} символов` : 'Выберите, о чём обращение',
      );
      return;
    }
    const input = { category, text: text.trim() };
    busy = true;
    try {
      await session.authorized((token) => api.sendSupport(token, input));
      haptic.success();
      toast.show('Спасибо! Ответ придёт от бота', 'success', 4000);
      // The answer comes through the bot.
      void askWriteAccess();
      back.go();
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
    }
  }

  const primary = usePrimaryAction(() => ({
    text: 'Отправить',
    state: busy ? 'loading' : complete ? 'ready' : 'incomplete',
    onClick: () => void submit(),
  }));
</script>

<svelte:head>
  <title>Написать нам — MASL</title>
</svelte:head>

<main class="min-h-app pb-8">
  <PageHeader title="Написать нам" subtitle="Идея, ошибка или вопрос — прочитаем всё" />
  <form
    class="flex flex-col gap-4 px-5 pt-5"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <fieldset class="flex flex-wrap gap-2">
      <legend class="mb-2 text-sm text-gray-light">О чём обращение</legend>
      {#each SUPPORT_CATEGORIES as option (option)}
        <label
          class="flex min-h-10 cursor-pointer items-center rounded-full border px-4 text-[0.9375rem] has-focus-visible:outline-2 {category ===
          option
            ? 'border-brand bg-brand/20 font-semibold'
            : 'border-gray-dark text-gray-light'}"
        >
          <input
            type="radio"
            name="support-category"
            value={option}
            bind:group={category}
            class="sr-only"
            onchange={() => haptic.select()}
          />
          {SUPPORT_CATEGORY_LABELS[option]}
        </label>
      {/each}
    </fieldset>
    <label class="flex flex-col gap-2">
      <span class="sr-only">Текст обращения</span>
      <textarea
        bind:value={text}
        rows="7"
        maxlength={SUPPORT_TEXT_MAX}
        class="resize-none rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-3 text-base text-paper placeholder:text-gray"
        placeholder="Опишите, что случилось или что хочется улучшить"
      ></textarea>
      <span class="self-end text-xs text-gray-light">{text.length} / {SUPPORT_TEXT_MAX}</span>
    </label>
    <p class="text-[0.8125rem] leading-relaxed text-gray-light">
      Ответ пришлёт бот. Написать можно и в самом боте командой /feedback.
    </p>
  </form>

  {#if primary.fallback}
    <BottomAction {...primary.fallback} />
  {/if}
</main>
