<script lang="ts">
  import { REPORT_COMMENT_MAX, REPORT_REASONS, type ReportReason } from '@masl/shared';
  import { REPORT_REASON_LABELS } from '#lib/format/labels.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import Sheet from './Sheet.svelte';

  interface Props {
    lobbyId: string;
    /** After the report went through; `hidden` when the lobby is gone for the viewer. */
    ondone: (hidden: boolean) => void;
  }

  let { lobbyId, ondone }: Props = $props();

  let reason = $state<ReportReason | null>(null);
  let comment = $state('');
  let busy = $state(false);

  async function submit() {
    if (!reason || busy) return;
    busy = true;
    try {
      await lobbyCache.report(lobbyId, { reason, comment: comment.trim() || null });
      haptic.success();
      closeSheet();
      ondone(lobbyCache.get(lobbyId) === undefined);
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet name="report" title="Пожаловаться на встречу">
  <form
    class="flex flex-col gap-4"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <p class="text-sm leading-relaxed text-gray-light">
      Организатор не узнает, кто пожаловался. Модератор проверит встречу.
    </p>
    <fieldset class="flex flex-col gap-2">
      <legend class="sr-only">Причина</legend>
      {#each REPORT_REASONS as option (option)}
        <label
          class="flex min-h-12 items-center gap-3 rounded-2xl border px-4 {reason === option
            ? 'border-brand bg-brand/20'
            : 'border-gray-dark bg-gray-dark/40'}"
        >
          <input
            type="radio"
            name="report-reason"
            value={option}
            bind:group={reason}
            class="size-4 accent-brand"
            onchange={() => haptic.select()}
          />
          {REPORT_REASON_LABELS[option]}
        </label>
      {/each}
    </fieldset>
    <label class="flex flex-col gap-2">
      <span class="text-sm text-gray-light">Что не так? Необязательно</span>
      <textarea
        bind:value={comment}
        rows="3"
        maxlength={REPORT_COMMENT_MAX}
        class="resize-none rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-3 text-base text-paper placeholder:text-gray"
        placeholder="Например: просит перевести предоплату в личку"
      ></textarea>
      <span class="self-end text-xs text-gray-light">{comment.length} / {REPORT_COMMENT_MAX}</span>
    </label>
    <button
      type="submit"
      class="min-h-12 rounded-2xl bg-brand text-lg font-bold text-paper disabled:opacity-50"
      disabled={!reason || busy}
      aria-busy={busy}
    >
      {busy ? 'Отправляем…' : 'Отправить жалобу'}
    </button>
  </form>
</Sheet>
