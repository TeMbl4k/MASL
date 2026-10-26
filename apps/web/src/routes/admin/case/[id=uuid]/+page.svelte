<script lang="ts">
  import {
    APPEAL_RETRY_DAYS,
    CASE_DECISIONS,
    CREATION_BLOCKED_TITLES,
    MODERATION_COMMENT_MAX,
    type AdminCaseDto,
    type ModerationDecision,
  } from '@masl/shared';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { api, ApiError } from '#lib/api.js';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import LobbyBlock from '#lib/components/moderation/LobbyBlock.svelte';
  import SubjectCard from '#lib/components/moderation/SubjectCard.svelte';
  import UserStats from '#lib/components/moderation/UserStats.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatTimeAgo } from '#lib/format/datetime.js';
  import {
    CASE_KIND_LABELS,
    DECISION_LABELS,
    REPORT_NOT_COUNTED_LABELS,
    REPORT_REASON_LABELS,
  } from '#lib/format/labels.js';
  import {
    accountAge,
    blockCause,
    flakeConsequences,
    formatDay,
    formatLogTime,
    reportsCount,
  } from '#lib/moderation.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity, clock } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { confirm } from '#lib/tg/popup.js';
  import { formatKarmaDelta } from '#lib/components/KarmaCard.svelte';

  const REJECT_NEEDS_REASON = 'Напишите причину отказа: её увидит пользователь';

  const id = $derived(page.params.id ?? '');

  let kase = $state<AdminCaseDto | null>(null);
  let failure = $state<'forbidden' | 'not-found' | null>(null);
  let loadError = $state<string | null>(null);
  let busy = $state(false);
  let controller: AbortController | null = null;

  let comment = $state('');
  let commentError = $state<string | null>(null);
  let cancelUpcoming = $state(true);
  let blockCreation = $state(false);
  let refundKarma = $state(true);

  const open = $derived(kase?.status === 'open');
  const decisions = $derived(kase ? CASE_DECISIONS[kase.kind] : []);
  const countedReports = $derived(
    kase ? kase.reports.filter((report) => report.notCounted === null).length : 0,
  );
  const cancellable = $derived(kase?.kind === 'reports' && kase.lobby?.status === 'open');

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      kase = await session.authorized((token) => api.adminCase(token, id, current.signal));
      failure = null;
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        failure = error.status === 403 ? 'forbidden' : 'not-found';
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update' || kase) toast.error(error);
      else loadError = shown.text;
    }
  }

  $effect(() => {
    void id;
    if (appActivity.active) untrack(() => void load());
  });

  /** What the decision will do, for the confirmation popup. */
  function consequences(current: AdminCaseDto, decision: ModerationDecision): string {
    switch (decision) {
      case 'reports_confirmed':
        return [
          'Теневой бан останется, пока его не снимут в карточке пользователя.',
          cancelUpcoming && current.upcomingLobbies > 0 ? `Отменим встречи: ${current.upcomingLobbies}.` : '',
          blockCreation ? 'Создавать встречи будет нельзя.' : '',
        ]
          .filter(Boolean)
          .join(' ');
      case 'reports_dismissed':
        return current.shadowBannedAt
          ? 'Теневой бан снимем, жалобы закроем.'
          : 'Жалобы закроем без последствий.';
      case 'meetup_held':
        return 'Дело закроем, карма не изменится.';
      case 'host_flaked':
        return current.lobby ? flakeConsequences(current.lobby) : '';
      case 'appeal_approved':
        return `Создавать встречи снова можно.${refundKarma && current.refund > 0 ? ` Вернём карму: ${formatKarmaDelta(current.refund)}.` : ''}`;
      case 'appeal_rejected':
        return `Причину увидит пользователь. Новую апелляцию можно подать через ${APPEAL_RETRY_DAYS} дней.`;
    }
  }

  async function decide(decision: ModerationDecision): Promise<void> {
    if (!kase || busy) return;
    const text = comment.trim();
    if (decision === 'appeal_rejected' && text === '') {
      commentError = REJECT_NEEDS_REASON;
      haptic.error();
      return;
    }
    commentError = null;
    const confirmed = await confirm({
      title: `${DECISION_LABELS[decision]}?`,
      message: consequences(kase, decision),
      confirmText: 'Подтвердить',
      destructive: decision === 'reports_confirmed' || decision === 'host_flaked',
    });
    if (!confirmed) return;
    busy = true;
    try {
      kase = await session.authorized((token) =>
        api.resolveCase(token, id, {
          decision,
          comment: text || null,
          cancelUpcoming,
          blockCreation,
          refundKarma: refundKarma && kase!.refund > 0,
        }),
      );
      haptic.success();
      toast.show('Решение сохранено', 'success');
      if (session.state.status === 'ready' && session.state.user.moderationQueue) {
        const user = session.state.user;
        session.setUser({ ...user, moderationQueue: Math.max(0, (user.moderationQueue ?? 1) - 1) });
      }
    } catch (error) {
      toast.error(error);
      void load();
    } finally {
      busy = false;
    }
  }

  async function cancelLobby(): Promise<void> {
    const lobby = kase?.lobby;
    if (!kase || !lobby || busy) return;
    const confirmed = await confirm({
      title: 'Отменить встречу?',
      message: `«${lobby.title}» отменим без штрафа хосту, участники получат сообщение от бота.`,
      confirmText: 'Отменить встречу',
      destructive: true,
    });
    if (!confirmed) return;
    busy = true;
    try {
      const response = await session.authorized((token) =>
        api.adminCancelLobby(token, lobby.id, comment.trim() || null),
      );
      kase = { ...kase, lobby: response.lobby, upcomingLobbies: Math.max(0, kase.upcomingLobbies - 1) };
      haptic.success();
      toast.show('Встреча отменена', 'success');
    } catch (error) {
      toast.error(error);
      void load();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Дело — MASL</title>
</svelte:head>

<main class="min-h-app pb-10">
  {#if failure}
    <PageHeader title={failure === 'forbidden' ? 'Раздел только для модераторов' : 'Дело не найдено'} />
    <div class="px-5 pt-4">
      <a href="/admin" class="inline-block rounded-2xl bg-brand px-6 py-3 text-lg font-bold text-paper"
        >К очереди</a
      >
    </div>
  {:else if !kase}
    <PageHeader title="Дело" />
    <div class="flex flex-col gap-3 px-5 pt-4">
      {#if loadError}
        <ErrorState title="Не удалось загрузить дело" message={loadError} onretry={() => void load()} />
      {:else}
        <div class="h-20 animate-pulse rounded-3xl bg-gray-dark/40" aria-busy="true"></div>
        <div class="h-40 animate-pulse rounded-3xl bg-gray-dark/40"></div>
      {/if}
    </div>
  {:else}
    <PageHeader
      eyebrow="Модерация"
      title={CASE_KIND_LABELS[kase.kind]}
      subtitle="Дело открыто {formatTimeAgo(kase.openedAt, clock.now)}"
    >
      {#snippet right()}
        {#if kase?.shadowBannedAt}
          <span class="rounded-full bg-brand-deep/40 px-2.5 py-1 text-xs text-brand-light"
            >Теневой бан с {formatLogTime(kase.shadowBannedAt)}</span
          >
        {/if}
      {/snippet}
    </PageHeader>

    <div class="flex flex-col gap-5 px-5 pt-5">
      <SubjectCard user={kase.subject} href="/admin/user/{kase.subject.id}" />
      <UserStats stats={kase.stats} />

      {#if kase.kind === 'appeal'}
        <section
          class="flex flex-col gap-2 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 px-4 py-3.5 text-sm"
        >
          {#if kase.block}
            <span class="font-semibold"
              >{CREATION_BLOCKED_TITLES[kase.block.kind]}, с {formatDay(kase.block.since)}</span
            >
            {#if blockCause(kase.block)}<span class="text-paper/85">{blockCause(kase.block)}</span>{/if}
          {:else}
            <span class="text-gray-light">Блокировки сейчас нет</span>
          {/if}
        </section>
        <section class="flex flex-col gap-2" aria-labelledby="appeal-text-title">
          <h2 id="appeal-text-title" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
            Текст апелляции
          </h2>
          <p class="leading-relaxed break-words whitespace-pre-line">{kase.appealText}</p>
        </section>
      {/if}

      {#if kase.lobby}
        <LobbyBlock lobby={kase.lobby} label={kase.kind === 'reports' ? 'Встреча с жалобой' : 'Встреча'} />
        {#if cancellable}
          <button
            type="button"
            class="min-h-11 self-start rounded-xl bg-gray-dark px-4 text-paper disabled:opacity-50"
            disabled={busy || kase.isSelf}
            onclick={() => void cancelLobby()}
          >
            Отменить эту встречу
          </button>
        {/if}
      {/if}

      {#if kase.kind === 'reports'}
        <section class="flex flex-col gap-3" aria-labelledby="reports-title">
          <h2 id="reports-title" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
            {reportsCount(kase.reports.length, countedReports)}
          </h2>
          <ul
            class="flex flex-col divide-y divide-gray-dark rounded-2xl border border-gray-dark bg-gray-dark/40"
          >
            {#each kase.reports as report (report.id)}
              <li class="flex flex-col gap-0.5 px-4 py-3 text-sm">
                <span class="flex justify-between gap-3">
                  <a href="/admin/user/{report.reporter.id}" class="font-semibold"
                    >{report.reporter.firstName}
                    <span class="font-normal text-gray-light">· карма {report.reporter.karma}</span></a
                  >
                  <span class="shrink-0 text-gray-light"
                    >в MASL {accountAge(report.reporter.joinedAt, clock.now)}</span
                  >
                </span>
                <span class={report.notCounted ? 'text-gray-light' : ''}>
                  {REPORT_REASON_LABELS[report.reason]}{#if report.notCounted}
                    · не учтена: {REPORT_NOT_COUNTED_LABELS[report.notCounted]}{/if}
                  {#if report.lobby.id !== kase.lobby?.id}
                    <span class="text-gray-light">· «{report.lobby.title}»</span>
                  {/if}
                </span>
                {#if report.comment}
                  <span class="break-words whitespace-pre-line text-paper/85">«{report.comment}»</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if open}
        <section class="flex flex-col gap-3" aria-label="Решение">
          {#if kase.isSelf}
            <p class="text-sm text-gray-light" role="status">
              Это дело о вас: решение примет другой модератор.
            </p>
          {/if}
          {#if kase.kind === 'reports'}
            {#if kase.upcomingLobbies > 0}
              <label class="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  bind:checked={cancelUpcoming}
                  class="mt-0.5 size-5 shrink-0 accent-brand"
                />
                <span
                  >Отменить предстоящие встречи пользователя ({kase.upcomingLobbies}). Участники получат
                  сообщение от бота</span
                >
              </label>
            {/if}
            <label class="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                bind:checked={blockCreation}
                class="mt-0.5 size-5 shrink-0 accent-brand"
              />
              <span>Запретить создавать встречи</span>
            </label>
          {:else if kase.kind === 'appeal' && kase.refund > 0}
            <label class="flex items-start gap-3 text-sm">
              <input type="checkbox" bind:checked={refundKarma} class="mt-0.5 size-5 shrink-0 accent-brand" />
              <span>Вернуть карму за отмену: {formatKarmaDelta(kase.refund)}</span>
            </label>
          {/if}

          <label class="flex flex-col gap-2">
            <span class="text-sm text-gray-light">
              {kase.kind === 'appeal'
                ? 'Комментарий. При отказе его увидит пользователь'
                : 'Комментарий для журнала, необязательно'}
            </span>
            <textarea
              bind:value={comment}
              rows="3"
              maxlength={MODERATION_COMMENT_MAX}
              aria-invalid={commentError ? true : undefined}
              class="resize-none rounded-2xl border bg-gray-dark/40 px-4 py-3 text-base text-paper {commentError
                ? 'border-brand-light'
                : 'border-gray-dark'}"
              oninput={() => (commentError = null)}
            ></textarea>
            <span class="flex justify-between gap-3 text-xs text-gray-light">
              <span class="text-brand-light" role={commentError ? 'alert' : undefined}
                >{commentError ?? ''}</span
              >
              <span>{comment.length} / {MODERATION_COMMENT_MAX}</span>
            </span>
          </label>

          <div class="flex flex-col gap-2.5">
            {#each decisions as decision, index (decision)}
              <button
                type="button"
                class="min-h-12 rounded-2xl text-lg disabled:opacity-50 {index === 0
                  ? 'bg-brand font-bold text-paper'
                  : 'bg-gray-dark text-paper'}"
                disabled={busy || kase.isSelf}
                aria-busy={busy}
                onclick={() => void decide(decision)}
              >
                {kase.kind === 'appeal'
                  ? decision === 'appeal_approved'
                    ? 'Снять блокировку'
                    : 'Отклонить'
                  : DECISION_LABELS[decision]}
              </button>
            {/each}
          </div>
          <p class="text-[0.8125rem] leading-snug text-gray-light">
            {#if kase.kind === 'reports'}
              «Не подтвердились» снимет теневой бан, если его поставили жалобы этого дела. «Подтверждено»
              оставит его, пока модератор не снимет вручную.
            {:else if kase.kind === 'not_held' && kase.lobby}
              «Сорвал»: {flakeConsequences(kase.lobby)}
            {:else}
              После отказа новую апелляцию можно подать через {APPEAL_RETRY_DAYS} дней.
            {/if}
          </p>
        </section>
      {:else}
        <section
          class="flex flex-col gap-1.5 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 px-4 py-3.5 text-sm"
          role="status"
        >
          <span class="font-semibold">{kase.decision ? DECISION_LABELS[kase.decision] : 'Дело закрыто'}</span>
          <span class="text-gray-light">
            {kase.resolvedBy?.firstName ?? 'Модератор'}{kase.resolvedAt
              ? ` · ${formatLogTime(kase.resolvedAt)}`
              : ''}
          </span>
          {#if kase.decisionComment}
            <span class="break-words whitespace-pre-line text-paper/85">{kase.decisionComment}</span>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</main>
