<script lang="ts">
  import type { ApplicantDto } from '@masl/shared';
  import { formatTimeAgo } from '#lib/format/datetime.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import Avatar from './Avatar.svelte';
  import Star from './icons/Star.svelte';

  interface Props {
    applicant: ApplicantDto;
    /** Approve and reject buttons; omitted for members, rejected rows and a closed lobby. */
    actions?: {
      onapprove: () => void;
      onreject: () => void;
      /** The lobby is full: approving is not possible. */
      full: boolean;
      busy: boolean;
    };
  }

  let { applicant, actions }: Props = $props();

  const user = $derived(applicant.user);
  const blockedByKarma = $derived(!applicant.meetsMinKarma);
</script>

<!-- An applicant as the host sees them: name, photo, karma and the newbie flag; no age or gender. -->
<li
  class="flex flex-col gap-3 {actions
    ? 'rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 p-3.5'
    : ''}"
>
  <div class="flex items-center gap-3">
    <Avatar name={user.firstName} src={user.photoUrl} size={actions ? 44 : 36} />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="truncate font-semibold {actions ? 'text-base' : 'text-[0.9375rem] font-normal'}">
        {user.firstName}
      </span>
      <span class="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-gray-light">
        <span class="inline-flex items-center gap-1" aria-label="Карма {user.karma}">
          <Star size={12} strokeWidth={1.5} class="text-brand" />
          {user.karma}
        </span>
        {#if user.isNewbie}
          <span aria-hidden="true">·</span>
          <span>Новичок</span>
        {/if}
        {#if actions}
          <span aria-hidden="true">·</span>
          <span>{formatTimeAgo(applicant.appliedAt, clock.now)}</span>
        {/if}
      </span>
    </div>
  </div>
  {#if actions}
    {#if blockedByKarma}
      <p class="text-sm text-gray-light">Карма ниже порога</p>
    {/if}
    <div class="grid grid-cols-2 gap-2">
      <button
        type="button"
        class="min-h-11 rounded-[0.875rem] border border-gray-dark text-[0.9375rem] disabled:opacity-50"
        disabled={actions.busy}
        onclick={actions.onreject}
      >
        Отклонить
      </button>
      <button
        type="button"
        class="min-h-11 rounded-[0.875rem] bg-brand text-[0.9375rem] font-bold text-paper disabled:bg-gray-dark disabled:text-gray-light"
        disabled={actions.busy || actions.full || blockedByKarma}
        aria-busy={actions.busy}
        onclick={actions.onapprove}
      >
        Одобрить
      </button>
    </div>
  {/if}
</li>
