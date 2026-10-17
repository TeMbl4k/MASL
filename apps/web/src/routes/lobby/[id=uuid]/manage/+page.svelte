<script lang="ts">
  import { effectiveLobbyStatus, type ApplicantDto } from '@masl/shared';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { ApiError } from '#lib/api.js';
  import ApplicantRow from '#lib/components/ApplicantRow.svelte';
  import CancelLobbySheet from '#lib/components/CancelLobbySheet.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import ChevronDown from '#lib/components/icons/ChevronDown.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatLobbyStart } from '#lib/format/datetime.js';
  import { applications } from '#lib/stores/applications.svelte.js';
  import { appActivity, clock, usePolling } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { confirm } from '#lib/tg/popup.js';

  /** New applications are polled this often while the page is in front. */
  const POLL_MS = 20_000;

  const id = $derived(page.params.id ?? '');
  const list = $derived(applications.get(id));
  const lobby = $derived(list?.lobby);
  const open = $derived(lobby ? effectiveLobbyStatus(lobby, clock.now) === 'open' : false);
  const full = $derived(lobby ? lobby.approvedCount >= lobby.slots : false);

  let failure = $state<'not-host' | 'not-found' | null>(null);
  let loadError = $state<string | null>(null);
  let controller: AbortController | null = null;

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      await applications.load(id, current.signal);
      failure = null;
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        failure = error.status === 403 ? 'not-host' : 'not-found';
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
    }
  }

  $effect(() => {
    void id;
    if (appActivity.active) untrack(() => void load());
  });
  // Only while there is something to decide: not after a 403/404 or once the lobby closed.
  usePolling(
    () => void load(),
    POLL_MS,
    () => failure === null && open,
  );

  async function approve(applicant: ApplicantDto) {
    haptic.success();
    try {
      await applications.approve(id, applicant.applicationId);
    } catch (error) {
      toast.error(error);
      void load();
    }
  }

  async function reject(applicant: ApplicantDto) {
    const confirmed = await confirm({
      title: 'Отклонить заявку?',
      message: `${applicant.user.firstName} не сможет подать заявку на эту встречу снова.`,
      confirmText: 'Отклонить',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await applications.reject(id, applicant.applicationId);
    } catch (error) {
      toast.error(error);
      void load();
    }
  }
</script>

<svelte:head>
  <title>Заявки — MASL</title>
</svelte:head>

{#snippet sectionTitle(text: string)}
  <h2 class="text-[0.9375rem] font-semibold">{text}</h2>
{/snippet}

<main class="min-h-dvh pb-10">
  {#if failure}
    <PageHeader title={failure === 'not-host' ? 'Это не ваша встреча' : 'Встреча не найдена'} />
    <div class="px-5 pt-4">
      <a href="/" class="inline-block rounded-2xl bg-brand px-6 py-3 text-lg font-bold text-paper"
        >На главную</a
      >
    </div>
  {:else if !list || !lobby}
    <PageHeader title="Заявки" />
    <div class="flex flex-col gap-3 px-5 pt-4">
      {#if loadError}
        <ErrorState title="Не удалось загрузить заявки" message={loadError} onretry={() => void load()} />
      {:else}
        <div class="h-28 animate-pulse rounded-3xl bg-gray-dark/40" aria-busy="true"></div>
        <div class="h-28 animate-pulse rounded-3xl bg-gray-dark/40"></div>
      {/if}
    </div>
  {:else}
    <PageHeader
      eyebrow="Заявки"
      title={lobby.title}
      subtitle="{formatLobbyStart(
        lobby.startsAt,
        clock.now,
      )} · Одобрено {lobby.approvedCount} из {lobby.slots}"
    />

    <div class="flex flex-col gap-6 px-5 pt-5">
      {#if !open}
        <p class="rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-3 text-sm" role="status">
          Набор закрыт
        </p>
      {:else if full}
        <p class="rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-3 text-sm" role="status">
          Все места заняты
        </p>
      {/if}

      <section class="flex flex-col gap-2.5" aria-label="Новые заявки">
        {@render sectionTitle(`Новые заявки · ${list.pending.length}`)}
        {#if list.pending.length === 0}
          <p class="text-sm text-gray-light">
            {open ? 'Заявок пока нет. Встреча уже в ленте.' : 'Новых заявок нет.'}
          </p>
        {:else}
          <ul class="flex flex-col gap-2.5">
            {#each list.pending as applicant (applicant.applicationId)}
              <ApplicantRow
                {applicant}
                actions={open
                  ? {
                      onapprove: () => void approve(applicant),
                      onreject: () => void reject(applicant),
                      full,
                      busy: applications.isDeciding(applicant.applicationId),
                    }
                  : undefined}
              />
            {/each}
          </ul>
        {/if}
      </section>

      <section class="flex flex-col gap-2.5" aria-label="Участники">
        {@render sectionTitle(`Участники · ${list.approved.length}`)}
        {#if list.approved.length === 0}
          <p class="text-sm text-gray-light">Пока никого не одобрили</p>
        {:else}
          <ul class="flex flex-col gap-2.5">
            {#each list.approved as applicant (applicant.applicationId)}
              <ApplicantRow {applicant} />
            {/each}
          </ul>
        {/if}
      </section>

      {#if list.rejected.length > 0}
        <details class="group flex flex-col gap-2.5">
          <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-gray-light">
            Отклонённые · {list.rejected.length}
            <ChevronDown size={16} class="transition group-open:rotate-180" />
          </summary>
          <ul class="flex flex-col gap-2.5 pt-1">
            {#each list.rejected as applicant (applicant.applicationId)}
              <ApplicantRow {applicant} />
            {/each}
          </ul>
        </details>
      {/if}

      {#if open}
        <div class="flex justify-center pt-2">
          <button
            type="button"
            class="min-h-11 rounded-[0.875rem] border border-brand-deep/70 px-5 text-[0.9375rem] text-brand-light"
            onclick={() => void openSheet('cancel-lobby')}
          >
            Отменить встречу
          </button>
        </div>
      {/if}
    </div>
  {/if}
</main>

{#if lobby && open}
  <CancelLobbySheet {lobby} ondone={() => void load()} />
{/if}
