<script lang="ts">
  import type { CompanionDto } from '@masl/shared';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import KarmaBadge from '#lib/components/KarmaBadge.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { describeError } from '#lib/errors.js';
  import { formatShortDate } from '#lib/format/datetime.js';
  import { LOBBY_FORMS, plural } from '#lib/format/plural.js';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';

  let items = $state<CompanionDto[] | null>(null);
  let loadError = $state<string | null>(null);

  async function load(): Promise<void> {
    loadError = null;
    try {
      items = (await session.authorized((token) => api.companions(token))).items;
    } catch (error) {
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
    }
  }

  onMount(() => void load());
</script>

<svelte:head>
  <title>Напарники — MASL</title>
</svelte:head>

<main class="min-h-app pb-10">
  <PageHeader title="Напарники" subtitle="Список видите только вы" />
  <div class="flex flex-col gap-4 px-5 pt-5">
    <p class="text-sm leading-relaxed text-gray-light">
      Напарники — люди, с которыми вас отметили на одной встрече. Другим видно только их число.
    </p>
    {#if loadError}
      <ErrorState title="Не удалось загрузить напарников" message={loadError} onretry={() => void load()} />
    {:else if items === null}
      <div class="flex flex-col gap-2" aria-busy="true">
        <div class="h-16 animate-pulse rounded-2xl bg-gray-dark/40"></div>
        <div class="h-16 animate-pulse rounded-2xl bg-gray-dark/40"></div>
      </div>
    {:else if items.length === 0}
      <EmptyState
        title="Пока никого"
        text="Сходите на встречу: когда организатор отметит, кто пришёл, участники станут вашими напарниками."
      >
        {#snippet actions()}
          <a href="/" class="flex min-h-11 items-center rounded-2xl bg-brand px-6 text-lg font-bold">
            Найти встречу
          </a>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="flex flex-col gap-1.5">
        {#each items as item (item.person.code)}
          <li>
            <a
              href="/u/{item.person.code}"
              class="flex min-h-16 items-center gap-3 rounded-2xl border border-gray-dark bg-gray-dark/30 px-3 py-2.5"
            >
              <Avatar name={item.person.firstName} src={item.person.photoUrl} size={44} />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate">{item.person.firstName}</span>
                <span class="text-[0.8125rem] text-gray-light">
                  {plural(item.meetups, LOBBY_FORMS)} вместе · последняя {formatShortDate(item.lastMetAt)}
                </span>
              </span>
              <KarmaBadge karma={item.person.karma} />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>
