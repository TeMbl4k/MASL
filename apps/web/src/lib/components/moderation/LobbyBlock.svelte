<script lang="ts">
  import { LOBBY_CATEGORY_INFO, formatMoscowTime, type AdminLobbyDto } from '@masl/shared';
  import { formatLobbyWhen } from '#lib/format/datetime.js';
  import { LOBBY_CANCEL_REASON_LABELS, formatSeats } from '#lib/format/labels.js';
  import { FEEDBACK_LABELS, formatLogTime, memberMark } from '#lib/moderation.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { formatKarmaDelta } from '../KarmaCard.svelte';

  interface Props {
    lobby: AdminLobbyDto;
    /** «Встреча», «Последняя встреча с жалобой». */
    label: string;
  }

  let { lobby, label }: Props = $props();
</script>

<section class="flex flex-col gap-3" aria-label={label}>
  <div class="flex flex-col gap-1.5 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 px-4 py-3.5">
    <span class="text-xs tracking-[0.12em] text-gray-light uppercase">{label}</span>
    <span class="font-semibold break-words">{lobby.title}</span>
    <span class="text-[0.8125rem] text-gray-light">
      {LOBBY_CATEGORY_INFO[lobby.category].title} · {formatLobbyWhen(lobby.startsAt, lobby.endsAt, clock.now)}
      · {lobby.placeHint} · {formatSeats(lobby.slots, lobby.approvedCount)}
    </span>
    {#if lobby.description}
      <p class="text-sm leading-relaxed break-words whitespace-pre-line text-paper/85">{lobby.description}</p>
    {/if}
    {#if lobby.cancelledAt}
      <span class="text-[0.8125rem] text-brand-light">
        Отменена {formatLogTime(lobby.cancelledAt)}{lobby.cancelReason
          ? ` · ${lobby.cancelReason === 'moderation' ? 'модерацией' : LOBBY_CANCEL_REASON_LABELS[lobby.cancelReason]}`
          : ''}
      </span>
    {:else if lobby.attendanceSavedAt}
      <span class="text-[0.8125rem] text-gray-light">
        Явка отмечена {formatLogTime(lobby.attendanceSavedAt)}{lobby.hostedDelta !== null
          ? `, хосту ${formatKarmaDelta(lobby.hostedDelta)} за встречу`
          : ''}
      </span>
    {/if}
  </div>

  {#if lobby.members.length > 0}
    <h3 class="text-[0.8125rem] tracking-widest text-gray-light uppercase">Участники, явка и отзывы</h3>
    <ul class="flex flex-col divide-y divide-gray-dark rounded-2xl border border-gray-dark bg-gray-dark/40">
      {#each lobby.members as member (member.user.id)}
        <li class="flex flex-col gap-0.5 px-4 py-3 text-sm">
          <span class="flex justify-between gap-3">
            <a href="/admin/user/{member.user.id}" class="font-semibold underline-offset-2 hover:underline"
              >{member.user.firstName}
              <span class="font-normal text-gray-light">· карма {member.user.karma}</span></a
            >
            <span class={member.status === 'no_show' ? 'text-brand-light' : 'text-gray-light'}>
              {memberMark(member)}
            </span>
          </span>
          <span class="text-[0.8125rem] text-gray-light">
            {#if member.checkedInAt}«Я на месте» в {formatMoscowTime(member.checkedInAt)} ·
            {/if}{member.feedback ? `Отзыв: «${FEEDBACK_LABELS[member.feedback]}»` : 'отзыва нет'}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
