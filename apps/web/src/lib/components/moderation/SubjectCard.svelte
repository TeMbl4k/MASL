<script lang="ts">
  import type { AdminUserDto } from '@masl/shared';
  import { ROLE_LABELS } from '#lib/format/labels.js';
  import { accountAge } from '#lib/moderation.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import Avatar from '../Avatar.svelte';
  import ChevronRight from '../icons/ChevronRight.svelte';

  interface Props {
    user: AdminUserDto;
    /** Links to the user card; left out on the card itself. */
    href?: string;
  }

  let { user, href }: Props = $props();

  const name = $derived([user.firstName, user.lastName].filter(Boolean).join(' '));
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  {href}
  class="flex items-center gap-3 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 px-4 py-3.5"
>
  <Avatar name={user.firstName} src={user.photoUrl} size={48} />
  <span class="flex min-w-0 flex-1 flex-col gap-1">
    <span class="font-semibold break-words">
      {name}{#if user.username}<span class="font-normal text-gray-light"> · @{user.username}</span>{/if}
    </span>
    <span class="text-[0.8125rem] text-gray-light">
      ID {user.telegramId} · в MASL {accountAge(user.joinedAt, clock.now)} · карма {user.karma}
    </span>
    {#if user.role !== 'user' || user.isShadowBanned || user.creationBlock}
      <span class="flex flex-wrap gap-1.5 pt-0.5 text-xs">
        {#if user.role !== 'user'}
          <span class="rounded-full bg-gray-dark px-2 py-0.5">{ROLE_LABELS[user.role]}</span>
        {/if}
        {#if user.isShadowBanned}
          <span class="rounded-full bg-brand-deep/40 px-2 py-0.5 text-brand-light">Теневой бан</span>
        {/if}
        {#if user.creationBlock}
          <span class="rounded-full bg-brand-deep/40 px-2 py-0.5 text-brand-light"
            >Не может создавать встречи</span
          >
        {/if}
      </span>
    {/if}
  </span>
  {#if href}<ChevronRight size={20} class="shrink-0 text-gray-light" />{/if}
</svelte:element>
