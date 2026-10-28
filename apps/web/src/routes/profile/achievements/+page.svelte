<script lang="ts">
  import {
    ACHIEVEMENT_TEXTS,
    ACHIEVEMENTS,
    achievementGroup,
    type AchievementDto,
    type AchievementGroup,
    type MyAchievementsResponse,
  } from '@masl/shared';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import AchievementIcon from '#lib/components/achievements/AchievementIcon.svelte';
  import ProgressBar from '#lib/components/achievements/ProgressBar.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { describeError } from '#lib/errors.js';
  import { formatShortDate } from '#lib/format/datetime.js';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';

  const GROUPS: readonly { id: AchievementGroup; title: string }[] = [
    { id: 'meetups', title: 'На встречах' },
    { id: 'hosting', title: 'Свои встречи' },
    { id: 'friends', title: 'Друзья' },
  ];

  let data = $state<MyAchievementsResponse | null>(null);
  let loadError = $state<string | null>(null);

  const earned = $derived(data?.items.filter((item) => item.earnedAt !== null).length ?? 0);
  const inGroup = (group: AchievementGroup): AchievementDto[] =>
    data?.items.filter((item) => achievementGroup(item.id) === group) ?? [];

  async function load(): Promise<void> {
    loadError = null;
    try {
      data = await session.authorized((token) => api.myAchievements(token));
    } catch (error) {
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
    }
  }

  onMount(() => void load());
</script>

<svelte:head>
  <title>Мои ачивки — MASL</title>
</svelte:head>

<main class="min-h-app pb-10">
  <PageHeader title="Мои ачивки" eyebrow="Профиль">
    {#snippet heading()}Мои <span class="font-semibold italic">ачивки</span>{/snippet}
  </PageHeader>
  <div class="flex flex-col gap-4 px-5 pt-4">
    {#if loadError}
      <ErrorState title="Не удалось загрузить ачивки" message={loadError} onretry={() => void load()} />
    {:else if data === null}
      <div class="flex flex-col gap-2" aria-busy="true">
        <div class="h-16 animate-pulse rounded-2xl bg-gray-dark/40"></div>
        <div class="h-16 animate-pulse rounded-2xl bg-gray-dark/40"></div>
        <div class="h-16 animate-pulse rounded-2xl bg-gray-dark/40"></div>
      </div>
    {:else}
      <p class="text-sm leading-relaxed text-gray-light">
        Получено {earned} из {ACHIEVEMENTS.length}. Ачивки даются за отмеченную явку и проведённые встречи,
        карму не меняют.
      </p>
      {#each GROUPS as group (group.id)}
        <section class="flex flex-col gap-2.5" aria-labelledby="group-{group.id}">
          <h2 id="group-{group.id}" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
            {group.title}
          </h2>
          <ul class="overflow-hidden rounded-2xl border border-gray-dark bg-gray-dark/40">
            {#each inGroup(group.id) as item (item.id)}
              {@const texts = ACHIEVEMENT_TEXTS[item.id]}
              <li class="flex items-center gap-3 border-b border-gray-dark/70 px-3.5 py-2.5 last:border-b-0">
                <AchievementIcon id={item.id} locked={item.earnedAt === null} />
                {#if item.earnedAt}
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="font-semibold">{texts.title}</span>
                    <span class="text-xs text-gray-light">{texts.condition}</span>
                  </span>
                  <span class="shrink-0 text-xs text-gray-light">
                    <span class="sr-only">Получена</span>
                    {formatShortDate(item.earnedAt)}
                  </span>
                {:else}
                  <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span class="flex items-baseline justify-between gap-2">
                      <span class="font-semibold">{texts.title}</span>
                      <span class="shrink-0 text-xs text-gray-light">{item.current} из {item.goal}</span>
                    </span>
                    <span class="text-xs text-gray-light">{texts.condition}</span>
                    <ProgressBar current={item.current} goal={item.goal} />
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>
</main>
