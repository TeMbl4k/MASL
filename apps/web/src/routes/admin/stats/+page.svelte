<script lang="ts">
  import type { AdminStatsDto, ArrivalSource, StatsPeriod } from '@masl/shared';
  import { untrack } from 'svelte';
  import { api, ApiError } from '#lib/api.js';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import AdminTabs from '#lib/components/moderation/AdminTabs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Segmented from '#lib/components/wizard/Segmented.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatShortDate } from '#lib/format/datetime.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';

  const PERIODS: readonly { value: StatsPeriod; label: string }[] = [
    { value: '7d', label: '7 дней' },
    { value: '30d', label: '30 дней' },
    { value: 'all', label: 'Всё время' },
  ];
  const SOURCE_LABELS: Record<ArrivalSource, string> = {
    friends: 'От друзей',
    tag: 'Метка',
    none: 'Без ссылки',
  };

  let period = $state<StatsPeriod>('7d');
  let stats = $state<AdminStatsDto | null>(null);
  let forbidden = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let controller: AbortController | null = null;

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      stats = await session.authorized((token) => api.adminStats(token, { period }, current.signal));
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && error.status === 403) {
        forbidden = error.message;
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update' || stats) toast.error(error);
      else loadError = shown.text;
    }
  }

  $effect(() => {
    void period;
    if (appActivity.active) untrack(() => void load());
  });

  const percent = (part: number, whole: number) =>
    whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
  const peak = $derived(Math.max(1, ...(stats?.byDay.map((day) => day.count) ?? [])));
</script>

<svelte:head>
  <title>Статистика — MASL</title>
</svelte:head>

{#snippet tile(value: number | string, label: string)}
  <div class="flex flex-col rounded-2xl border border-gray-dark bg-gray-dark/40 px-3 py-2.5">
    <dt class="order-2 text-xs text-gray-light">{label}</dt>
    <dd class="order-1 text-xl font-semibold">{value}</dd>
  </div>
{/snippet}

{#snippet heading(text: string)}
  <h2 class="text-[0.8125rem] tracking-widest text-gray-light uppercase">{text}</h2>
{/snippet}

<main class="min-h-app pb-10">
  <PageHeader title="Статистика" subtitle="Дни считаются по московскому времени" />
  <div class="flex flex-col gap-5 px-5 pt-5">
    <AdminTabs />
    {#if forbidden}
      <EmptyState title="Раздел только для админов" text={forbidden} />
    {:else}
      <Segmented options={PERIODS} bind:value={period} label="Период" />

      {#if !stats && loadError}
        <ErrorState title="Не удалось загрузить статистику" message={loadError} onretry={() => void load()} />
      {:else if !stats}
        <div class="flex flex-col gap-3" aria-busy="true">
          <div class="h-20 animate-pulse rounded-2xl bg-gray-dark/40"></div>
          <div class="h-32 animate-pulse rounded-2xl bg-gray-dark/40"></div>
        </div>
      {:else}
        <section class="flex flex-col gap-2.5">
          {@render heading('Уникальные пользователи')}
          <dl class="grid grid-cols-3 gap-2">
            {@render tile(stats.uniques.today, 'сегодня')}
            {@render tile(stats.uniques.days7, 'за 7 дней')}
            {@render tile(stats.uniques.days30, 'за 30 дней')}
          </dl>
          {#if stats.byDay.length > 0}
            <figure class="flex flex-col gap-1.5 rounded-2xl border border-gray-dark bg-gray-dark/40 p-3">
              <div class="flex h-28 items-end gap-px" aria-hidden="true">
                {#each stats.byDay as day (day.date)}
                  <div
                    class="min-w-0 flex-1 rounded-t-sm bg-brand"
                    style:height="{Math.max(2, (day.count / peak) * 100)}%"
                    title="{formatShortDate(day.date)}: {day.count}"
                  ></div>
                {/each}
              </div>
              <table class="sr-only">
                <caption>Уникальные пользователи по дням</caption>
                <tbody>
                  {#each stats.byDay as day (day.date)}
                    <tr><th scope="row">{formatShortDate(day.date)}</th><td>{day.count}</td></tr>
                  {/each}
                </tbody>
              </table>
              <figcaption class="flex justify-between text-xs text-gray-light">
                <span>{formatShortDate(stats.byDay[0].date)}</span>
                <span>максимум {peak} в день</span>
                <span>{formatShortDate(stats.byDay[stats.byDay.length - 1].date)}</span>
              </figcaption>
            </figure>
          {/if}
        </section>

        <section class="flex flex-col gap-2.5">
          {@render heading('Пользователи за период')}
          <dl class="grid grid-cols-3 gap-2">
            {@render tile(stats.users.new, 'новых')}
            {@render tile(stats.users.onboarded, 'прошли анкету')}
            {@render tile(stats.returning, 'пришли второй раз')}
          </dl>
        </section>

        <section class="flex flex-col gap-2.5">
          {@render heading('Встречи за период')}
          <dl class="grid grid-cols-3 gap-2">
            {@render tile(stats.lobbies.created, 'создано')}
            {@render tile(stats.lobbies.held, 'состоялось')}
            {@render tile(stats.lobbies.cancelled, 'отменено')}
            {@render tile(
              percent(stats.attendance.attended, stats.attendance.attended + stats.attendance.noShow),
              'явка',
            )}
            {@render tile(stats.attendance.noShow, 'неявок')}
            {@render tile(stats.reports, 'жалоб')}
          </dl>
        </section>

        <section class="flex flex-col gap-2.5">
          {@render heading('Откуда пришли новые')}
          {#if stats.sources.length === 0}
            <p class="text-sm text-gray-light">За период новых пользователей нет</p>
          {:else}
            <table class="w-full text-left text-sm">
              <thead class="text-xs text-gray-light">
                <tr>
                  <th scope="col" class="py-1.5 font-normal">Источник</th>
                  <th scope="col" class="py-1.5 text-right font-normal">новых</th>
                  <th scope="col" class="py-1.5 text-right font-normal">анкета</th>
                  <th scope="col" class="py-1.5 text-right font-normal">на встрече</th>
                </tr>
              </thead>
              <tbody>
                {#each stats.sources as source (`${source.kind}:${source.tag?.slug ?? ''}`)}
                  <tr class="border-t border-gray-dark">
                    <th scope="row" class="py-2 font-normal break-words">
                      {source.tag ? source.tag.title : SOURCE_LABELS[source.kind]}
                    </th>
                    <td class="py-2 text-right">{source.newUsers}</td>
                    <td class="py-2 text-right">{source.onboarded}</td>
                    <td class="py-2 text-right">{source.attended}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </section>
      {/if}
    {/if}
  </div>
</main>
