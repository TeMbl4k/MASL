<script lang="ts">
  import type { BroadcastDto, BroadcastsResponse } from '@masl/shared';
  import { untrack } from 'svelte';
  import { api, ApiError } from '#lib/api.js';
  import ProgressBar from '#lib/components/achievements/ProgressBar.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import Plus from '#lib/components/icons/Plus.svelte';
  import AdminTabs from '#lib/components/moderation/AdminTabs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { describeError } from '#lib/errors.js';
  import { formatTimeAgo } from '#lib/format/datetime.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity, clock, usePolling } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';

  /** While a broadcast is going out, its counters refresh this often. */
  const SENDING_POLL_MS = 5000;

  let data = $state<BroadcastsResponse | null>(null);
  let forbidden = $state<string | null>(null);
  let loadError = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      data = await session.authorized((token) => api.broadcasts(token));
      loadError = null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        forbidden = error.message;
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update' || data) toast.error(error);
      else loadError = shown.text;
    }
  }

  $effect(() => {
    if (appActivity.active) untrack(() => void load());
  });

  usePolling(
    () => void load(),
    SENDING_POLL_MS,
    () => data?.items.some((item) => item.pending > 0) ?? false,
  );

  function audience(item: BroadcastDto): string {
    const who = item.interests
      ? `По интересам: ${item.interests
          .map((slug) => session.interests.find((interest) => interest.slug === slug)?.title ?? slug)
          .join(', ')}`
      : 'Всем';
    const button = item.lobby ? `кнопка «Открыть встречу»: ${item.lobby.title}` : 'кнопка «Открыть MASL»';
    return `${who} · ${button}`;
  }
</script>

<svelte:head>
  <title>Рассылки — MASL</title>
</svelte:head>

{#snippet counter(value: number, label: string)}
  <div class="flex flex-col-reverse gap-0.5 rounded-xl bg-ink/60 px-2.5 py-2">
    <dt class="text-[0.6875rem] text-gray-light">{label}</dt>
    <dd class="text-[1.0625rem] font-semibold">{value}</dd>
  </div>
{/snippet}

<main class="min-h-app pb-10">
  <PageHeader title="Рассылки" eyebrow="Админка" />
  <div class="flex flex-col gap-4 px-5 pt-5">
    <AdminTabs />
    {#if forbidden}
      <EmptyState title="Раздел только для админов" text={forbidden} />
    {:else if !data && loadError}
      <ErrorState title="Не удалось загрузить" message={loadError} onretry={() => void load()} />
    {:else if !data}
      <div class="flex flex-col gap-2.5" aria-busy="true">
        <div class="h-14 animate-pulse rounded-2xl bg-gray-dark/40"></div>
        <div class="h-32 animate-pulse rounded-2xl bg-gray-dark/40"></div>
      </div>
    {:else}
      <a
        href="/admin/broadcasts/new"
        class="flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-brand text-[1.0625rem] font-semibold text-paper"
      >
        <Plus size={20} />Новая рассылка
      </a>
      <p class="text-[0.8125rem] leading-relaxed text-gray-light">
        Подписаны на новости {data.people.subscribed} из {data.people.total}. Каждый получает не больше одной
        рассылки за сутки.
      </p>

      <h2 class="text-[0.8125rem] tracking-widest text-gray-light uppercase">История</h2>
      {#if data.items.length === 0}
        <p class="text-sm text-gray-light">Рассылок пока не было</p>
      {:else}
        <ul class="flex flex-col gap-2.5">
          {#each data.items as item (item.id)}
            {@const sending = item.pending > 0}
            <li
              class="flex flex-col gap-2.5 rounded-2xl border bg-gray-dark/40 p-3.5 {sending
                ? 'border-brand'
                : 'border-gray-dark'}"
            >
              <span class="flex justify-between gap-2 text-xs">
                <span
                  class="font-semibold tracking-wider uppercase {sending
                    ? 'text-brand-light'
                    : 'text-gray-light'}"
                >
                  {sending ? 'Отправляется' : 'Отправлено'}
                </span>
                <span class="text-gray-light">
                  {formatTimeAgo(item.createdAt, clock.now)}{#if item.author}{' · '}{item.author
                      .firstName}{/if}
                </span>
              </span>
              <p class="line-clamp-4 text-[0.9375rem] leading-snug whitespace-pre-line">{item.text}</p>
              <p class="text-[0.8125rem] text-gray-light">{audience(item)}</p>
              {#if sending}
                <ProgressBar current={item.recipients - item.pending} goal={item.recipients} thick />
                <p class="text-[0.8125rem]">
                  {item.recipients - item.pending} из {item.recipients} отправлено
                </p>
              {:else}
                <dl class="grid grid-cols-3 gap-1.5">
                  {@render counter(item.delivered, 'доставлено')}
                  {@render counter(item.failed, 'не дошло')}
                  {@render counter(item.unsubscribed, 'отписались')}
                </dl>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</main>
