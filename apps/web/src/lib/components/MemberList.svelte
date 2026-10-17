<script lang="ts">
  import type { PersonDto } from '@masl/shared';
  import Avatar from './Avatar.svelte';
  import Star from './icons/Star.svelte';

  interface Props {
    host: PersonDto;
    /** Approved and attended members; null when the viewer may only see the count. */
    members: PersonDto[] | null;
    approvedCount: number;
    slots: number;
  }

  let { host, members, approvedCount, slots }: Props = $props();
</script>

{#snippet row(person: PersonDto, role: string | null)}
  <li class="flex items-center gap-3">
    <Avatar name={person.firstName} src={person.photoUrl} size={36} />
    <span class="min-w-0 flex-1 truncate text-[0.9375rem]">
      {person.firstName}
      {#if role}<span class="text-[0.8125rem] text-gray-light">· {role}</span>{/if}
    </span>
    <span class="flex items-center gap-1 text-sm text-gray-light" aria-label="Карма {person.karma}">
      <Star size={13} strokeWidth={1.5} class="text-brand" />
      {person.karma}
    </span>
  </li>
{/snippet}

<section aria-labelledby="members-title" class="flex flex-col gap-2.5">
  <h2 id="members-title" class="text-xs tracking-widest text-gray-light uppercase">
    Участники · {approvedCount} из {slots}
  </h2>
  {#if members}
    <ul class="flex flex-col gap-2.5">
      {@render row(host, 'организатор')}
      {#each members as member, index (index)}
        {@render row(member, null)}
      {/each}
    </ul>
    {#if members.length === 0}
      <p class="text-sm text-gray-light">Пока никого не одобрили</p>
    {/if}
  {:else}
    <p class="text-sm text-gray-light">Имена участников видят хост и одобренные участники</p>
  {/if}
</section>
