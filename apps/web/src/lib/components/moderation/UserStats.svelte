<script lang="ts">
  import type { AdminUserStatsDto } from '@masl/shared';

  let { stats }: { stats: AdminUserStatsDto } = $props();

  const cells = $derived([
    { value: stats.hosted, label: 'организовано' },
    { value: stats.attended, label: 'посещено' },
    { value: stats.noShows, label: 'неявок' },
    { value: stats.lateCancels + stats.hostLateCancels, label: 'поздних отмен' },
    { value: stats.reportsReceived, label: 'жалоб' },
  ]);
</script>

<section class="flex flex-col gap-2.5" aria-label="Статистика">
  <dl class="grid grid-cols-3 gap-2 sm:grid-cols-5">
    {#each cells as cell (cell.label)}
      <div class="flex flex-col rounded-2xl border border-gray-dark bg-gray-dark/40 px-3 py-2.5">
        <dt class="order-2 text-xs text-gray-light">{cell.label}</dt>
        <dd class="order-1 text-xl font-semibold">{cell.value}</dd>
      </div>
    {/each}
  </dl>
  <p class="text-[0.8125rem] text-gray-light">
    Отзывы о встречах как хоста: хорошо {stats.feedback.good} · плохо {stats.feedback.bad} · не состоялась {stats
      .feedback.notHeld}
  </p>
</section>
