<script lang="ts">
  import {
    APPLICATIONS_PENDING_MAX,
    effectiveLobbyStatus,
    formatMoscowTime,
    isLateCancel,
    KARMA,
    LATE_CANCEL_WINDOW_HOURS,
    LOBBY_CATEGORY_INFO,
    type LobbyCardDto,
    type LobbyStatus,
  } from '@masl/shared';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import BottomAction from '#lib/components/BottomAction.svelte';
  import CancelLobbySheet from '#lib/components/CancelLobbySheet.svelte';
  import CheckInCard from '#lib/components/CheckInCard.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import ExactPlaceBlock from '#lib/components/ExactPlaceBlock.svelte';
  import Alert from '#lib/components/icons/Alert.svelte';
  import Check from '#lib/components/icons/Check.svelte';
  import ChevronRight from '#lib/components/icons/ChevronRight.svelte';
  import Clock from '#lib/components/icons/Clock.svelte';
  import Lock from '#lib/components/icons/Lock.svelte';
  import Star from '#lib/components/icons/Star.svelte';
  import LobbyFacts from '#lib/components/LobbyFacts.svelte';
  import MeetupChatCard from '#lib/components/MeetupChatCard.svelte';
  import MemberList from '#lib/components/MemberList.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import ReportSheet from '#lib/components/ReportSheet.svelte';
  import ShareSheet from '#lib/components/ShareSheet.svelte';
  import StatusPill from '#lib/components/StatusPill.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatLobbyWhen, formatShortDate } from '#lib/format/datetime.js';
  import { formatSeats, LOBBY_CANCEL_REASON_LABELS } from '#lib/format/labels.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity, clock, usePolling } from '#lib/stores/clock.svelte.js';
  import { feed } from '#lib/stores/feed.svelte.js';
  import { filters } from '#lib/stores/filters.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { myLobbies } from '#lib/stores/my-lobbies.svelte.js';
  import { origin } from '#lib/stores/origin.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { confirm } from '#lib/tg/popup.js';
  import { usePrimaryAction } from '#lib/tg/primary-action.svelte.js';
  import { askWriteAccess } from '#lib/tg/write-access.js';

  /** A pending applicant's page polls for the host's answer this often. */
  const PENDING_POLL_MS = 30_000;
  const LATE_CANCEL_PENALTY = Math.abs(KARMA.LATE_CANCEL);

  const id = $derived(page.params.id ?? '');
  const entry = $derived(lobbyCache.get(id));
  const detail = $derived(entry?.detail);
  /** The cached card renders first; the detail fills in the rest. */
  const lobby = $derived<LobbyCardDto | undefined>(detail ?? entry?.card);
  const status = $derived<LobbyStatus | null>(lobby ? effectiveLobbyStatus(lobby, clock.now) : null);
  const viewerKarma = $derived(session.state.status === 'ready' ? session.state.user.karma : null);
  const botCanWrite = $derived(session.state.status === 'ready' ? session.state.user.botCanWrite : true);
  /** The host marks who came after the end, until the deadline. */
  const attendanceOpen = $derived(detail?.attendance?.state === 'open');

  let descriptionEl = $state<HTMLElement | null>(null);
  let expanded = $state(false);
  /** The description is longer than six lines, so «Показать полностью» is offered. */
  let clamped = $state(false);

  $effect(() => {
    void detail?.description;
    if (descriptionEl && !expanded) clamped = descriptionEl.scrollHeight > descriptionEl.clientHeight + 1;
  });

  let notFound = $state(false);
  let loadError = $state<string | null>(null);
  let busy = $state(false);
  let controller: AbortController | null = null;

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      // A cold deep link (the bot) hasn't restored the saved station yet; it gives the distance.
      await origin.restore();
      await lobbyCache.load(id, current.signal);
      notFound = false;
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && error.status === 404) {
        notFound = true;
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
    }
  }

  /** A reporter who is not a member no longer sees the lobby: back to the feed without it. */
  function reported(hidden: boolean) {
    if (!hidden) {
      toast.show('Жалоба отправлена', 'success');
      return;
    }
    toast.show('Жалоба отправлена. Эту встречу вы больше не увидите', 'success');
    void feed.refresh();
    void goto('/', { replace: true });
  }

  // Loads on open, on another lobby id, and when the app comes back to the front.
  $effect(() => {
    void id;
    if (appActivity.active) untrack(() => void load());
  });

  /**
   * What the page says and offers, checked top-down (spec §9.6): the lobby's state first, then
   * the viewer's membership, then the API's apply block.
   */
  type Situation =
    | 'cancelled'
    | 'host'
    | 'pending'
    | 'pending_started'
    | 'member'
    | 'apply'
    | 'karma'
    | 'full'
    | 'started'
    | 'finished'
    | 'rejected'
    | 'left'
    | 'pending_limit'
    | 'applications_daily_limit'
    | 'none';

  function situationOf(card: LobbyCardDto, effective: LobbyStatus): Situation {
    if (effective === 'cancelled') return 'cancelled';
    if (card.viewer.isHost) return 'host';
    const membership = card.viewer.membershipStatus;
    if (membership === 'pending') return effective === 'open' ? 'pending' : 'pending_started';
    if (membership === 'approved' && effective !== 'finished') return 'member';
    if (effective === 'active') return 'started';
    if (effective === 'finished') return 'finished';
    switch (card.viewer.applyBlock) {
      case null:
        return 'apply';
      case 'not_open':
        return 'started';
      case 'karma':
      case 'full':
      case 'rejected':
      case 'left':
      case 'pending_limit':
      case 'applications_daily_limit':
        return card.viewer.applyBlock;
      default:
        return 'none';
    }
  }

  const situation = $derived<Situation>(lobby && status ? situationOf(lobby, status) : 'none');
  const showLock = $derived(
    ['apply', 'karma', 'full', 'pending', 'pending_limit', 'applications_daily_limit'].includes(situation),
  );

  usePolling(
    () => void load(),
    PENDING_POLL_MS,
    () => situation === 'pending',
  );

  async function apply() {
    if (busy) return;
    busy = true;
    try {
      await lobbyCache.apply(id);
      haptic.success();
      toast.show('Заявка отправлена. Ответ хоста появится здесь и в «Моих событиях»', 'success', 5000);
      // The bot brings the answer and the exact address; asking doesn't hold the apply up.
      void askWriteAccess();
    } catch (error) {
      toast.error(error);
      void load();
    } finally {
      busy = false;
    }
  }

  async function cancelApplication() {
    if (busy || !lobby) return;
    const approved = lobby.viewer.membershipStatus === 'approved';
    const late = approved && isLateCancel(lobby.startsAt, Date.now());
    const confirmed = await confirm(
      approved
        ? {
            title: 'Отменить участие?',
            message: late
              ? `До начала меньше ${LATE_CANCEL_WINDOW_HOURS} часов: карма снизится на ${LATE_CANCEL_PENALTY}. Подать заявку снова будет нельзя.`
              : 'Место освободится для других. Карма не изменится. Подать заявку на эту встречу снова будет нельзя.',
            confirmText: 'Отменить',
            destructive: true,
          }
        : {
            title: 'Отменить заявку?',
            message: 'Хост ещё не ответил. Заявку можно будет подать снова.',
            confirmText: 'Отменить',
            destructive: true,
          },
    );
    if (!confirmed) return;
    busy = true;
    try {
      const { karmaDelta } = await lobbyCache.cancelApplication(id);
      if (karmaDelta !== 0)
        toast.show(`Карма ${karmaDelta < 0 ? '−' : '+'}${Math.abs(karmaDelta)}`, 'info', 4000);
      else toast.show(approved ? 'Вы отменили участие' : 'Заявка отменена');
    } catch (error) {
      toast.error(error);
      void load();
    } finally {
      busy = false;
    }
  }

  /** Answers the viewer's invite: «Иду» on the host's makes a member, on a member's an application. */
  async function answerInvite(accept: boolean) {
    const invite = detail?.invite;
    if (busy || !invite) return;
    busy = true;
    try {
      await session.authorized((token) =>
        accept ? api.acceptInvite(token, invite.id) : api.declineInvite(token, invite.id),
      );
      if (accept) {
        haptic.success();
        toast.show(
          invite.byHost ? 'Вы участник. Точный адрес пришлёт бот' : 'Заявка отправлена. Решает организатор',
          'success',
          5000,
        );
        void askWriteAccess();
      } else {
        toast.show('Приглашение отклонено');
      }
      myLobbies.invalidate();
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
      void load();
    }
  }

  function findSimilar() {
    if (lobby) filters.category = lobby.category;
    void goto('/');
  }

  const primary = usePrimaryAction(() => {
    const pending = lobby?.pendingCount ?? 0;
    if (detail?.invite && status === 'open') {
      return { text: 'Иду', state: busy ? 'loading' : 'ready', onClick: () => void answerInvite(true) };
    }
    switch (situation) {
      case 'host':
        if (attendanceOpen) {
          return { text: 'Отметить, кто пришёл', onClick: () => void goto(`/lobby/${id}/attendance`) };
        }
        return {
          text: pending > 0 ? `Управлять заявками (${pending})` : 'Управлять заявками',
          onClick: () => void goto(`/lobby/${id}/manage`),
        };
      case 'apply':
        return {
          text: lobby?.viewer.membershipStatus === 'cancelled' ? 'Подать заявку снова' : 'Подать заявку',
          state: busy ? 'loading' : 'ready',
          onClick: () => void apply(),
        };
      case 'karma':
        return { text: `Нужна карма от ${lobby?.minKarma ?? ''}`, state: 'disabled', onClick: () => {} };
      case 'full':
        return { text: 'Мест нет', state: 'disabled', onClick: () => {} };
      case 'pending_limit':
      case 'applications_daily_limit':
        return { text: 'Подать заявку', state: 'disabled', onClick: () => {} };
      default:
        return { text: '', visible: false, onClick: () => {} };
    }
  });
</script>

<svelte:head>
  <title>{lobby?.title ?? 'Встреча'} — MASL</title>
</svelte:head>

{#snippet notice(tone: 'brand' | 'pending' | 'muted', title: string, text?: string | null)}
  <div
    class="flex items-start gap-3 rounded-[1.125rem] p-3.5 {tone === 'brand'
      ? 'bg-brand-card text-paper'
      : tone === 'pending'
        ? 'border border-sand/50 bg-sand/10'
        : 'border border-gray-dark bg-gray-dark/40'}"
    role="status"
  >
    <span
      class="flex size-9 shrink-0 items-center justify-center rounded-full {tone === 'brand'
        ? 'bg-ink/25'
        : 'bg-gray-dark'}"
    >
      {#if tone === 'brand'}
        <Check size={20} strokeWidth={2.4} />
      {:else if tone === 'pending'}
        <Clock size={20} class="text-sand" />
      {:else}
        <Alert size={20} class="text-gray-light" />
      {/if}
    </span>
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="font-semibold">{title}</span>
      {#if text}<span class="text-[0.8125rem] break-words {tone === 'brand' ? '' : 'text-gray-light'}"
          >{text}</span
        >{/if}
    </div>
  </div>
{/snippet}

{#snippet secondary(text: string, onclick: () => void, hint?: string)}
  <div class="flex flex-col items-center gap-1.5 pt-2">
    <button
      type="button"
      class="min-h-11 rounded-[0.875rem] border border-gray-dark px-5 text-[0.9375rem] disabled:opacity-50"
      disabled={busy}
      {onclick}
    >
      {text}
    </button>
    {#if hint}<span class="text-center text-xs text-gray-light">{hint}</span>{/if}
  </div>
{/snippet}

<main class="bg-brand-glow min-h-app pb-8">
  {#if notFound}
    <PageHeader title="Встреча не найдена" />
    <div class="flex flex-col items-start gap-4 px-5 pt-4">
      <p class="text-gray-light">Возможно, ссылка устарела.</p>
      <a href="/" class="rounded-2xl bg-brand px-6 py-3 text-lg font-bold text-paper">На главную</a>
    </div>
  {:else if !lobby}
    <PageHeader title="Встреча" />
    <div class="flex flex-col gap-4 px-5 pt-4">
      {#if loadError}
        <ErrorState title="Не удалось загрузить встречу" message={loadError} onretry={() => void load()} />
      {:else}
        <div class="h-40 animate-pulse rounded-3xl bg-gray-dark/40" aria-busy="true"></div>
        <div class="h-20 animate-pulse rounded-3xl bg-gray-dark/40"></div>
      {/if}
    </div>
  {:else}
    {@const category = LOBBY_CATEGORY_INFO[lobby.category]}
    <PageHeader title={lobby.title} subtitle="{category.emoji} {category.title}">
      {#snippet right()}
        <StatusPill {lobby} />
      {/snippet}
    </PageHeader>

    <div class="flex flex-col gap-[1.125rem] px-5 pt-5">
      {#if detail?.invite && status === 'open'}
        {@const invite = detail.invite}
        <div class="flex flex-col gap-3 rounded-[1.125rem] bg-brand-card p-4 text-paper" role="status">
          <span class="font-semibold">{invite.from} зовёт вас на встречу</span>
          <span class="text-[0.8125rem]">
            {invite.byHost
              ? 'Приглашение от организатора: после «Иду» вы сразу участник, адрес пришлёт бот.'
              : 'После «Иду» организатор получит заявку и решит.'}
          </span>
          <button
            type="button"
            class="min-h-11 self-start rounded-xl bg-ink/25 px-4 disabled:opacity-50"
            disabled={busy}
            onclick={() => void answerInvite(false)}
          >
            Не смогу
          </button>
        </div>
      {/if}
      {#if situation === 'cancelled'}
        {@const byModerator = detail?.cancelReason === 'moderation'}
        <div
          class="flex flex-col gap-3 rounded-[1.125rem] border border-brand-deep/60 bg-brand-deep/15 p-4"
          role="status"
        >
          <span class="font-semibold"
            >{byModerator
              ? 'Встречу отменила модерация'
              : lobby.viewer.isHost
                ? 'Вы отменили встречу'
                : 'Встреча отменена хостом'}</span
          >
          {#if detail?.cancelReason && !byModerator}
            <span class="text-sm">Причина: {LOBBY_CANCEL_REASON_LABELS[detail.cancelReason]}</span>
          {/if}
          {#if detail?.cancelComment}
            <span class="text-sm break-words text-gray-light">{detail.cancelComment}</span>
          {/if}
          {#if !lobby.viewer.isHost}
            <button
              type="button"
              class="min-h-11 self-start rounded-xl bg-gray-dark px-4 text-paper"
              onclick={findSimilar}
            >
              Найти похожие
            </button>
          {/if}
        </div>
      {:else if situation === 'member'}
        {@render notice('brand', 'Вы участник', 'Заявка одобрена. Ждём вас!')}
        {#if detail?.checkIn}
          <CheckInCard lobbyId={lobby.id} checkIn={detail.checkIn} />
        {/if}
        {#if !botCanWrite}
          <div
            class="flex flex-col gap-3 rounded-[1.125rem] border border-sand/50 bg-sand/10 p-3.5"
            role="status"
          >
            <span class="text-sm leading-relaxed">
              Адрес и новости встречи — только здесь: бот не может вам писать.
            </span>
            <button
              type="button"
              class="min-h-11 self-start rounded-xl bg-gray-dark px-4 text-paper"
              onclick={() => void askWriteAccess(true)}
            >
              Разрешить боту писать
            </button>
          </div>
        {/if}
      {:else if situation === 'pending'}
        {@render notice('pending', 'Ожидает подтверждения', 'Ждём ответа хоста')}
      {:else if situation === 'pending_started'}
        {@render notice('muted', 'Заявка не рассмотрена')}
      {:else if situation === 'started'}
        {@render notice('muted', 'Встреча уже началась — заявки закрыты')}
      {:else if situation === 'finished'}
        {@render notice('muted', 'Встреча завершена')}
      {:else if situation === 'rejected'}
        <div class="flex flex-col gap-3">
          {@render notice('muted', 'Хост отклонил заявку')}
          <a href="/" class="min-h-11 self-start rounded-xl bg-gray-dark px-4 py-2.5 text-paper"
            >Найти другие</a
          >
        </div>
      {:else if situation === 'left'}
        {@render notice('muted', 'Вы отменили участие')}
      {:else if situation === 'karma'}
        {@render notice(
          'muted',
          `Нужна карма от ${lobby.minKarma}`,
          `Сейчас у вас ${viewerKarma ?? '—'}. Карма растёт, когда вы приходите на встречи.`,
        )}
      {:else if situation === 'pending_limit'}
        {@render notice(
          'muted',
          `У вас уже ${APPLICATIONS_PENDING_MAX} заявок в ожидании`,
          'Дождитесь ответов или отмените лишние.',
        )}
      {:else if situation === 'applications_daily_limit'}
        {@render notice('muted', 'Слишком много заявок за сутки', 'Попробуйте завтра.')}
      {/if}

      <LobbyFacts {lobby} />

      <a
        href="/u/{lobby.host.code}"
        aria-label="Организатор: {lobby.host.firstName}, карма {lobby.host.karma}"
        class="flex items-center gap-3 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 p-3.5"
      >
        <Avatar name={lobby.host.firstName} src={lobby.host.photoUrl} size={44} />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs tracking-widest text-gray-light uppercase">Организатор</span>
          <span class="truncate font-semibold">{lobby.host.firstName}</span>
        </div>
        <span class="flex items-center gap-1 font-semibold" aria-label="Карма {lobby.host.karma}">
          <Star size={16} strokeWidth={1.5} class="text-brand" />
          {lobby.host.karma}
        </span>
        <ChevronRight size={18} class="text-gray-light" />
      </a>

      {#if status === 'open'}
        <div class="grid gap-2 {detail?.canInvite ? 'grid-cols-2' : 'grid-cols-1'}">
          <button
            type="button"
            class="min-h-11 rounded-[0.875rem] border border-gray-dark px-4 text-[0.9375rem]"
            onclick={() => void openSheet('share')}
          >
            Поделиться
          </button>
          {#if detail?.canInvite}
            <a
              href="/lobby/{lobby.id}/invite"
              class="flex min-h-11 items-center justify-center rounded-[0.875rem] border border-brand/70 px-4 text-[0.9375rem] text-brand-light"
            >
              Пригласить
            </a>
          {/if}
        </div>
      {/if}

      {#if detail}
        {#if detail.description}
          <div class="flex flex-col items-start gap-1">
            <p
              bind:this={descriptionEl}
              class="text-[0.9375rem] leading-normal break-words whitespace-pre-line text-paper/85 {expanded
                ? ''
                : 'line-clamp-6'}"
            >
              {detail.description}
            </p>
            {#if clamped && !expanded}
              <button type="button" class="min-h-11 text-sm text-brand" onclick={() => (expanded = true)}>
                Показать полностью
              </button>
            {/if}
          </div>
        {/if}

        {#if detail.access !== 'public'}
          <ExactPlaceBlock exactPlace={detail.exactPlace} place={detail.place} />
        {:else if showLock}
          <div class="flex gap-3 rounded-[1.125rem] border border-dashed border-brand/60 bg-brand/10 p-3.5">
            <Lock size={22} class="text-brand-light" />
            <span class="text-sm leading-relaxed">Точный адрес откроется после одобрения заявки</span>
          </div>
        {/if}

        {#if detail.chat}
          <MeetupChatCard lobbyId={lobby.id} chat={detail.chat} isHost={lobby.viewer.isHost} />
        {/if}

        {#if detail.attendance}
          {@const attendance = detail.attendance}
          <a
            href="/lobby/{lobby.id}/attendance"
            class="flex min-h-12 items-center justify-between gap-3 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 px-4 py-3"
          >
            <span class="flex flex-col gap-0.5">
              <span class="font-semibold">Кто пришёл</span>
              <span class="text-[0.8125rem] text-gray-light">
                {attendance.state === 'open'
                  ? `Отметьте до ${formatShortDate(attendance.deadline)}, ${formatMoscowTime(attendance.deadline)}`
                  : attendance.state === 'saved'
                    ? 'Отмечено, карма начислена'
                    : attendance.state === 'closed'
                      ? 'Время отметить вышло'
                      : 'Откроется после окончания'}
              </span>
            </span>
            <ChevronRight size={20} class="text-gray-light" />
          </a>
        {/if}

        {#if situation === 'host'}
          <a
            href="/lobby/{lobby.id}/manage"
            class="flex min-h-12 items-center justify-between rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 px-4"
          >
            <span class="font-semibold">Заявки · {lobby.pendingCount ?? 0}</span>
            <ChevronRight size={20} class="text-gray-light" />
          </a>
        {/if}

        <MemberList
          host={detail.host}
          members={detail.members}
          approvedCount={detail.approvedCount}
          slots={detail.slots}
        />

        {#if situation === 'pending'}
          {@render secondary('Отменить заявку', () => void cancelApplication())}
        {:else if situation === 'member' && status === 'open'}
          {@render secondary(
            'Отменить участие',
            () => void cancelApplication(),
            `Позже чем за ${LATE_CANCEL_WINDOW_HOURS} часа до начала карма снизится на ${LATE_CANCEL_PENALTY}`,
          )}
        {:else if situation === 'host' && status === 'open'}
          <div class="flex flex-col items-center gap-1.5 pt-2">
            <button
              type="button"
              class="min-h-11 rounded-[0.875rem] border border-brand-deep/70 px-5 text-[0.9375rem] text-brand-light"
              onclick={() => void openSheet('cancel-lobby')}
            >
              Отменить встречу
            </button>
            {#if detail.cancelPolicy}
              <span class="text-center text-xs text-gray-light">
                Без штрафа до {formatMoscowTime(detail.cancelPolicy.lateFrom)} или если места не заполнены
              </span>
            {/if}
          </div>
        {/if}
        {#if !lobby.viewer.isHost}
          {#if lobby.viewer.reported}
            <p class="pt-2 text-center text-sm text-gray-light">Вы пожаловались</p>
          {:else}
            <button
              type="button"
              class="min-h-11 self-center px-4 text-sm text-gray-light underline underline-offset-4"
              onclick={() => void openSheet('report')}
            >
              Пожаловаться
            </button>
          {/if}
        {/if}
      {:else if loadError}
        <ErrorState title="Не удалось загрузить встречу" message={loadError} onretry={() => void load()} />
      {:else}
        <div class="h-24 animate-pulse rounded-3xl bg-gray-dark/40" aria-busy="true"></div>
      {/if}
    </div>
  {/if}

  {#if primary.fallback}
    <BottomAction {...primary.fallback} />
  {/if}
</main>

{#if lobby && situation === 'host'}
  <CancelLobbySheet {lobby} ondone={() => void load()} />
{/if}
{#if lobby && !lobby.viewer.isHost && !lobby.viewer.reported}
  <ReportSheet lobbyId={lobby.id} ondone={reported} />
{/if}
{#if lobby}
  {@const shared = lobby}
  <ShareSheet
    input={{ kind: 'lobby', id: shared.id }}
    title="Поделиться встречей"
    note="Точный адрес в карточку не попадает."
  >
    {#snippet preview()}
      <div class="flex flex-col gap-1.5 rounded-2xl border border-gray-dark bg-ink/60 p-4">
        <span class="font-semibold break-words">{shared.title}</span>
        <span class="text-sm text-gray-light"
          >{formatLobbyWhen(shared.startsAt, shared.endsAt, clock.now)}</span
        >
        <span class="text-sm text-gray-light">{shared.place.hint}</span>
        <span class="text-sm text-gray-light">{formatSeats(shared.slots, shared.approvedCount)}</span>
        <span class="mt-1.5 rounded-xl bg-gray-dark py-2 text-center text-sm font-semibold"
          >Открыть встречу</span
        >
      </div>
    {/snippet}
  </ShareSheet>
{/if}
