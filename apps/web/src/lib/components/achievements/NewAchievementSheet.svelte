<script lang="ts">
  import { ACHIEVEMENT_TEXTS, type Achievement, type AchievementDto } from '@masl/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '#lib/api.js';
  import { session } from '#lib/session.svelte.js';
  import { closeSheet, openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { launchStartParam, startParamPath } from '#lib/tg/start-param.js';
  import Sheet from '../Sheet.svelte';
  import AchievementIcon from './AchievementIcon.svelte';
  import NextGoal from './NextGoal.svelte';

  /** Shown once: opening it marks the achievements seen. */
  let shown = $state<Achievement[]>([]);
  let next = $state<AchievementDto | null>(null);

  onMount(() => {
    if (session.state.status !== 'ready') return;
    const user = session.state.user;
    if (user.newAchievements.length === 0) return;
    // A link to a meetup or a profile opens its page now; the news waits for the next start.
    const startParam = launchStartParam();
    if (startParam && startParamPath(startParam)) return;
    shown = user.newAchievements;
    session.setUser({ ...user, newAchievements: [] });
    void session
      .authorized(async (token) => {
        const [mine] = await Promise.all([api.myAchievements(token), api.markAchievementsSeen(token)]);
        next = mine.items.find((item) => item.id === mine.next) ?? null;
      })
      .catch(() => undefined);
    haptic.success();
    void openSheet('new-achievement');
  });

  const first = $derived(shown[0]);
</script>

{#if first}
  <Sheet name="new-achievement" title={shown.length === 1 ? 'Новая ачивка' : 'Новые ачивки'}>
    <div class="flex flex-col items-center gap-4 text-center">
      <span class="bg-achievement-glow flex size-32 items-center justify-center rounded-full">
        <AchievementIcon id={first} size={96} class="ring-4 ring-brand ring-offset-4 ring-offset-ink" />
      </span>
      <p class="text-[1.75rem] font-semibold italic">{ACHIEVEMENT_TEXTS[first].title}</p>
      <p class="max-w-75 text-[0.9375rem] leading-relaxed text-gray-light">
        {ACHIEVEMENT_TEXTS[first].praise}
      </p>
      {#if shown.length > 1}
        <p class="text-sm text-gray-light">
          И ещё: {shown
            .slice(1)
            .map((id) => `«${ACHIEVEMENT_TEXTS[id].title}»`)
            .join(', ')}
        </p>
      {/if}
      {#if next}
        <div class="self-stretch text-left"><NextGoal item={next} label="Дальше" /></div>
      {/if}
      <div class="flex flex-col gap-2.5 self-stretch">
        <button
          type="button"
          class="min-h-14 rounded-2xl bg-brand text-lg font-bold text-paper"
          onclick={() => void goto('/profile/achievements', { replaceState: true })}
        >
          Все ачивки
        </button>
        <button
          type="button"
          class="min-h-12 rounded-2xl border border-gray-dark"
          onclick={() => closeSheet()}
        >
          Отлично
        </button>
      </div>
    </div>
  </Sheet>
{/if}
