<script lang="ts">
  import { LOBBY_CANCEL_COMMENT_MAX, LOBBY_CANCEL_REASONS, type LobbyCancelReason } from '@masl/shared';
  import { LOBBY_CANCEL_REASON_LABELS } from '#lib/format/labels.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import Sheet from './Sheet.svelte';

  interface Props {
    lobby: { id: string; slots: number; approvedCount: number };
    /** After the lobby was cancelled, or a refusal (the caller reloads its data). */
    ondone?: () => void;
  }

  let { lobby, ondone }: Props = $props();

  let reason = $state<LobbyCancelReason | null>(null);
  let comment = $state('');
  let busy = $state(false);

  /** «Не набрались участники» only while there are free seats. */
  const allowed = (r: LobbyCancelReason) => r !== 'not_enough_people' || lobby.approvedCount < lobby.slots;

  async function submit() {
    if (!reason || busy) return;
    busy = true;
    try {
      await lobbyCache.cancelLobby(lobby.id, { reason, comment: comment.trim() || null });
      haptic.success();
      closeSheet();
      toast.show('Встреча отменена', 'success');
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
      ondone?.();
    }
  }
</script>

<Sheet name="cancel-lobby" title="Отменить встречу">
  <form
    class="flex flex-col gap-4"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-2 text-sm text-gray-light">Почему отменяете?</legend>
      {#each LOBBY_CANCEL_REASONS as option (option)}
        {@const enabled = allowed(option)}
        <label
          class="flex min-h-12 items-center gap-3 rounded-2xl border px-4 {reason === option
            ? 'border-brand bg-brand/20'
            : 'border-gray-dark bg-gray-dark/40'} {enabled ? '' : 'opacity-50'}"
        >
          <input
            type="radio"
            name="cancel-reason"
            value={option}
            bind:group={reason}
            disabled={!enabled}
            class="size-4 accent-brand"
            onchange={() => haptic.select()}
          />
          {LOBBY_CANCEL_REASON_LABELS[option]}
        </label>
      {/each}
    </fieldset>
    <label class="flex flex-col gap-2">
      <span class="text-sm text-gray-light">Комментарий для участников (необязательно)</span>
      <input
        bind:value={comment}
        type="text"
        maxlength={LOBBY_CANCEL_COMMENT_MAX}
        class="min-h-12 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 text-base text-paper placeholder:text-gray"
        placeholder="Например: перенесём на следующую неделю"
      />
    </label>
    <button
      type="submit"
      class="min-h-12 rounded-2xl bg-brand-deep text-lg font-bold text-paper disabled:opacity-50"
      disabled={!reason || busy}
      aria-busy={busy}
    >
      {busy ? 'Отменяем…' : 'Отменить встречу'}
    </button>
  </form>
</Sheet>
