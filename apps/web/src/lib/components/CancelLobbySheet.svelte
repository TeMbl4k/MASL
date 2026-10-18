<script lang="ts">
  import {
    isHostLateCancel,
    KARMA,
    LOBBY_CANCEL_COMMENT_MAX,
    LOBBY_CANCEL_REASONS,
    type LobbyCancelReason,
  } from '@masl/shared';
  import { LOBBY_CANCEL_REASON_LABELS } from '#lib/format/labels.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import Alert from './icons/Alert.svelte';
  import Sheet from './Sheet.svelte';

  const PENALTY = Math.abs(KARMA.HOST_LATE_CANCEL);

  interface Props {
    lobby: { id: string; startsAt: string; slots: number; approvedCount: number };
    /** After the lobby was cancelled, or a refusal (the caller reloads its data). */
    ondone?: () => void;
  }

  let { lobby, ondone }: Props = $props();

  let reason = $state<LobbyCancelReason | null>(null);
  let comment = $state('');
  let busy = $state(false);

  /** The server decides; this only warns before the tap. */
  const late = $derived(isHostLateCancel(lobby, clock.now));

  /** «Не набрались участники» only while there are free seats. */
  const allowed = (r: LobbyCancelReason) => r !== 'not_enough_people' || lobby.approvedCount < lobby.slots;

  async function submit() {
    if (!reason || busy) return;
    busy = true;
    try {
      const { karmaDelta } = await lobbyCache.cancelLobby(lobby.id, {
        reason,
        comment: comment.trim() || null,
      });
      haptic.success();
      closeSheet();
      toast.show(
        karmaDelta === 0 ? 'Встреча отменена' : `Встреча отменена. Карма −${Math.abs(karmaDelta)}`,
        'success',
      );
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
    {#if late}
      <div class="flex gap-3 rounded-2xl border border-brand-deep/70 bg-brand-deep/15 p-3.5" role="alert">
        <Alert size={22} class="shrink-0 text-brand-light" />
        <div class="flex flex-col gap-1">
          <span class="font-semibold">Это поздняя отмена</span>
          <span class="text-sm leading-relaxed text-paper/85">
            До начала меньше часа, а все места заняты. Карма снизится на {PENALTY}, и создавать встречи станет
            нельзя.
          </span>
        </div>
      </div>
    {/if}
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
      {busy ? 'Отменяем…' : late ? `Отменить, −${PENALTY}` : 'Отменить встречу'}
    </button>
  </form>
</Sheet>
