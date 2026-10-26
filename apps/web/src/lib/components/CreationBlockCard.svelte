<script lang="ts">
  import {
    APPEAL_TEXT_MAX,
    APPEAL_TEXT_MIN,
    CREATION_BLOCKED_TITLES,
    type AppealStateDto,
  } from '@masl/shared';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import { blockCause, formatDay as day } from '#lib/moderation.js';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet, openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import Alert from './icons/Alert.svelte';
  import Sheet from './Sheet.svelte';

  /** Shown only while lobby creation is blocked; loads the block and the appeal itself. */
  let appealState = $state<AppealStateDto | null>(null);
  let text = $state('');
  let busy = $state(false);
  let tried = $state(false);

  const length = $derived(text.trim().length);
  const tooShort = $derived(length < APPEAL_TEXT_MIN);

  onMount(() => {
    session
      .authorized((token) => api.appeal(token))
      .then(
        (loaded) => (appealState = loaded),
        () => undefined,
      );
  });

  async function submit() {
    tried = true;
    if (tooShort || busy) return;
    busy = true;
    try {
      appealState = await session.authorized((token) => api.submitAppeal(token, text.trim()));
      haptic.success();
      closeSheet();
      toast.show('Апелляция отправлена. Ответ придёт в бот', 'success');
      text = '';
      tried = false;
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
    }
  }
</script>

{#if appealState?.block}
  {@const block = appealState.block}
  {@const appeal = appealState.appeal}
  <section
    class="flex flex-col gap-3 rounded-2xl border border-brand-light/60 bg-brand-deep/10 px-4 py-3.5 text-sm"
    aria-label="Блокировка создания встреч"
  >
    <p class="flex items-start gap-2 font-semibold">
      <Alert size={18} class="mt-px shrink-0 text-brand-light" />
      {CREATION_BLOCKED_TITLES[block.kind]}
    </p>
    {#if blockCause(block)}
      <p class="leading-relaxed text-paper/85">{blockCause(block)}</p>
    {/if}
    {#if appeal?.status === 'open'}
      <p class="text-gray-light">Апелляция на рассмотрении с {day(appeal.createdAt)}. Ответ придёт в бот.</p>
    {:else if appeal?.status === 'rejected'}
      <p class="leading-relaxed break-words whitespace-pre-line text-gray-light">
        Апелляцию отклонили{appeal.comment ? `: «${appeal.comment}»` : ''}.{appealState.retryAt
          ? ` Повторно можно с ${day(appealState.retryAt)}.`
          : ''}
      </p>
    {/if}
    {#if appealState.canAppeal}
      <button
        type="button"
        class="min-h-11 self-start rounded-xl bg-gray-dark px-4 text-paper"
        onclick={() => void openSheet('appeal')}
      >
        Подать апелляцию
      </button>
    {/if}
  </section>

  <Sheet name="appeal" title="Апелляция">
    <form
      class="flex flex-col gap-4"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div class="flex flex-col gap-1 text-sm">
        <span class="text-gray-light">За что блокировка</span>
        <span class="leading-relaxed">{blockCause(block) ?? CREATION_BLOCKED_TITLES[block.kind]}</span>
      </div>
      <label class="flex flex-col gap-2">
        <span class="text-sm text-gray-light">Расскажите, что случилось</span>
        <textarea
          bind:value={text}
          rows="5"
          maxlength={APPEAL_TEXT_MAX}
          aria-invalid={tried && tooShort ? true : undefined}
          class="resize-none rounded-2xl border bg-gray-dark/40 px-4 py-3 text-base text-paper placeholder:text-gray {tried &&
          tooShort
            ? 'border-brand-light'
            : 'border-gray-dark'}"
          placeholder="Например: клуб отменил бронь за час до игры, письмо могу прислать"
        ></textarea>
        <span class="flex justify-between gap-3 text-xs text-gray-light">
          <span
            class={tried && tooShort ? 'text-brand-light' : ''}
            role={tried && tooShort ? 'alert' : undefined}
          >
            {tried && tooShort ? `Опишите ситуацию: от ${APPEAL_TEXT_MIN} символов` : ''}
          </span>
          <span>{length} / {APPEAL_TEXT_MAX}</span>
        </span>
      </label>
      <p class="text-[0.8125rem] leading-snug text-gray-light">
        Ответ модератора придёт в бот. Если блокировку снимут, карму за отмену может вернуть модератор.
      </p>
      <button
        type="submit"
        class="min-h-12 rounded-2xl bg-brand text-lg font-bold text-paper disabled:opacity-50"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Отправляем…' : 'Отправить апелляцию'}
      </button>
    </form>
  </Sheet>
{/if}
