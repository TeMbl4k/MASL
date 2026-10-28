<script lang="ts">
  import {
    SUPPORT_CATEGORY_LABELS,
    SUPPORT_REPLY_MAX,
    type AdminSupportDto,
    type AdminSupportResponse,
    type SupportStatus,
  } from '@masl/shared';
  import { untrack } from 'svelte';
  import { api, ApiError } from '#lib/api.js';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import AdminTabs from '#lib/components/moderation/AdminTabs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Segmented from '#lib/components/wizard/Segmented.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatTimeAgo } from '#lib/format/datetime.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity, clock } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { confirm } from '#lib/tg/popup.js';

  let status = $state<SupportStatus>('open');
  let data = $state<AdminSupportResponse | null>(null);
  let forbidden = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  /** Reply drafts by request id. */
  let drafts = $state<Record<string, string>>({});
  let busyId = $state<string | null>(null);
  let loading = $state(true);
  let controller: AbortController | null = null;

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      data = await session.authorized((token) => api.adminSupport(token, { status }, current.signal));
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && error.status === 403) {
        forbidden = error.message;
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update' || data?.items.length) toast.error(error);
      else loadError = shown.text;
    }
    if (controller === current) loading = false;
  }

  $effect(() => {
    void status;
    if (appActivity.active) untrack(() => void load());
  });

  const options = $derived([
    { value: 'open' as const, label: data ? `Новые · ${data.counts.open}` : 'Новые' },
    { value: 'closed' as const, label: data ? `Закрытые · ${data.counts.closed}` : 'Закрытые' },
  ]);

  function switchStatus(next: SupportStatus): void {
    status = next;
    loading = true;
    data = data ? { ...data, items: [] } : null;
  }

  async function act(item: AdminSupportDto, reply: boolean): Promise<void> {
    if (busyId) return;
    const text = (drafts[item.id] ?? '').trim();
    if (reply && !text) {
      haptic.warning();
      toast.show('Напишите ответ');
      return;
    }
    if (
      !reply &&
      !(await confirm({
        title: 'Закрыть без ответа?',
        message: 'Автор не получит сообщения. Ответить потом будет нельзя.',
        confirmText: 'Закрыть',
      }))
    ) {
      return;
    }
    busyId = item.id;
    try {
      await session.authorized((token) =>
        reply ? api.replySupport(token, item.id, text) : api.closeSupport(token, item.id),
      );
      haptic.success();
      toast.show(reply ? 'Ответ отправлен через бота' : 'Обращение закрыто', 'success');
      delete drafts[item.id];
    } catch (error) {
      toast.error(error);
    } finally {
      busyId = null;
      void load();
    }
  }
</script>

<svelte:head>
  <title>Обращения — MASL</title>
</svelte:head>

<main class="min-h-app pb-10">
  <PageHeader title="Обращения" subtitle="Ответ уходит автору через бота, один раз" />
  <div class="flex flex-col gap-4 px-5 pt-5">
    <AdminTabs />
    {#if forbidden}
      <EmptyState title="Раздел только для админов" text={forbidden} />
    {:else}
      <Segmented {options} value={status} label="Обращения" onchange={switchStatus} />

      {#if !data && loadError}
        <ErrorState title="Не удалось загрузить обращения" message={loadError} onretry={() => void load()} />
      {:else if !data || (loading && data.items.length === 0)}
        <div class="flex flex-col gap-2.5" aria-busy="true">
          <div class="h-28 animate-pulse rounded-[1.125rem] bg-gray-dark/40"></div>
          <div class="h-28 animate-pulse rounded-[1.125rem] bg-gray-dark/40"></div>
        </div>
      {:else if data.items.length === 0}
        <EmptyState
          title={status === 'open' ? 'Новых обращений нет' : 'Закрытых обращений нет'}
          text={status === 'open' ? 'Бот напишет, когда придёт новое.' : undefined}
        />
      {:else}
        <ul class="flex flex-col gap-2.5">
          {#each data.items as item (item.id)}
            <li
              class="flex flex-col gap-2 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 px-4 py-3.5"
            >
              <span class="flex flex-wrap items-center gap-1.5 text-xs">
                <span class="rounded-full bg-gray-dark px-2 py-0.5"
                  >{SUPPORT_CATEGORY_LABELS[item.category]}</span
                >
                <span class="text-gray-light">{formatTimeAgo(item.createdAt, clock.now)}</span>
              </span>
              <a href="/admin/user/{item.author.id}" class="font-semibold">
                {item.author.firstName}{#if item.author.username}
                  <span class="font-normal text-gray-light">@{item.author.username}</span>{/if}
              </a>
              <p class="text-sm break-words whitespace-pre-line text-paper/85">{item.text}</p>
              {#if item.status === 'open'}
                <label class="flex flex-col gap-1.5">
                  <span class="sr-only">Ответ</span>
                  <textarea
                    bind:value={drafts[item.id]}
                    rows="3"
                    maxlength={SUPPORT_REPLY_MAX}
                    placeholder="Ответ автору"
                    class="resize-none rounded-2xl border border-gray-dark bg-ink/40 px-3.5 py-2.5 text-base text-paper placeholder:text-gray"
                  ></textarea>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="min-h-11 rounded-xl bg-brand px-4 font-semibold text-paper disabled:opacity-50"
                    disabled={busyId !== null}
                    aria-busy={busyId === item.id}
                    onclick={() => void act(item, true)}
                  >
                    Ответить
                  </button>
                  <button
                    type="button"
                    class="min-h-11 rounded-xl border border-gray-dark px-4 disabled:opacity-50"
                    disabled={busyId !== null}
                    onclick={() => void act(item, false)}
                  >
                    Закрыть без ответа
                  </button>
                </div>
              {:else if item.reply}
                <div class="rounded-xl bg-ink/40 px-3 py-2 text-sm">
                  <p class="text-xs text-gray-light">
                    Ответ{#if item.repliedBy}: {item.repliedBy.firstName}{/if}
                  </p>
                  <p class="break-words whitespace-pre-line">{item.reply}</p>
                </div>
              {:else}
                <p class="text-xs text-gray-light">Закрыто без ответа</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</main>
