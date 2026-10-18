<script lang="ts">
  import {
    CREATION_BLOCKED_TITLES,
    MODERATION_COMMENT_MAX,
    MODERATION_KARMA_DELTA_MAX,
    type AdminUserCardDto,
    type UserModerationAction,
  } from '@masl/shared';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { api, ApiError } from '#lib/api.js';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import ChevronRight from '#lib/components/icons/ChevronRight.svelte';
  import { formatKarmaDelta } from '#lib/components/KarmaCard.svelte';
  import ModerationHistory from '#lib/components/moderation/ModerationHistory.svelte';
  import SubjectCard from '#lib/components/moderation/SubjectCard.svelte';
  import UserStats from '#lib/components/moderation/UserStats.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Segmented from '#lib/components/wizard/Segmented.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatTimeAgo } from '#lib/format/datetime.js';
  import { CASE_KIND_LABELS } from '#lib/format/labels.js';
  import { blockCause, formatDay } from '#lib/moderation.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity, clock } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet, openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { confirm } from '#lib/tg/popup.js';

  type FlagAction = Exclude<UserModerationAction, 'karma_change'>;

  const id = $derived(page.params.id ?? '');

  let card = $state<AdminUserCardDto | null>(null);
  let failure = $state<'forbidden' | 'not-found' | null>(null);
  let loadError = $state<string | null>(null);
  let busy = $state(false);
  let controller: AbortController | null = null;

  let sign = $state<1 | -1>(-1);
  let amount = $state('');
  let karmaComment = $state('');
  let tried = $state(false);

  const delta = $derived(Number.parseInt(amount, 10));
  const amountValid = $derived(Number.isInteger(delta) && delta >= 1 && delta <= MODERATION_KARMA_DELTA_MAX);
  const commentValid = $derived(karmaComment.trim() !== '');

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      card = await session.authorized((token) => api.adminUser(token, id, current.signal));
      failure = null;
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        failure = error.status === 403 ? 'forbidden' : 'not-found';
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update' || card) toast.error(error);
      else loadError = shown.text;
    }
  }

  $effect(() => {
    void id;
    if (appActivity.active) untrack(() => void load());
  });

  async function act(action: UserModerationAction, extra: { karmaDelta?: number; comment?: string } = {}) {
    busy = true;
    try {
      card = await session.authorized((token) =>
        api.userAction(token, id, {
          action,
          karmaDelta: extra.karmaDelta ?? null,
          comment: extra.comment ?? null,
        }),
      );
      haptic.success();
      return true;
    } catch (error) {
      toast.error(error);
      void load();
      return false;
    } finally {
      busy = false;
    }
  }

  const FLAG_CONFIRMS: Readonly<
    Record<FlagAction, { title: string; message: string; destructive?: boolean }>
  > = {
    shadow_ban: {
      title: 'Включить теневой бан?',
      message:
        'Встречи и заявки пользователя скроем от всех, кроме уже одобренных участников. Сообщать об этом не будем.',
      destructive: true,
    },
    lift_shadow_ban: {
      title: 'Снять теневой бан?',
      message: 'Встречи и заявки пользователя снова увидят все.',
    },
    block_creation: {
      title: 'Запретить создавать встречи?',
      message: 'Запрет появится в профиле пользователя, там же можно подать апелляцию.',
      destructive: true,
    },
    unblock_creation: {
      title: 'Разрешить создавать встречи?',
      message: 'Открытая апелляция, если она есть, закроется как одобренная.',
    },
    grant_moderator: {
      title: 'Сделать модератором?',
      message: 'Откроется раздел «Модерация», бот начнёт присылать новые дела.',
    },
    revoke_moderator: { title: 'Снять с модераторов?', message: 'Раздел «Модерация» закроется сразу.' },
  };

  async function flag(action: FlagAction): Promise<void> {
    if (busy) return;
    const text = FLAG_CONFIRMS[action];
    const confirmed = await confirm({ ...text, confirmText: 'Подтвердить' });
    if (confirmed && (await act(action))) toast.show('Готово', 'success');
  }

  function openKarma(): void {
    sign = -1;
    amount = '';
    karmaComment = '';
    tried = false;
    void openSheet('moderation-action');
  }

  async function changeKarma(): Promise<void> {
    tried = true;
    if (!amountValid || !commentValid || busy) return;
    if (await act('karma_change', { karmaDelta: sign * delta, comment: karmaComment.trim() })) {
      closeSheet();
      toast.show('Карма изменена', 'success');
    }
  }
</script>

<svelte:head>
  <title>Пользователь — MASL</title>
</svelte:head>

{#snippet actionButton(text: string, onclick: () => void, hint?: string)}
  <button
    type="button"
    class="flex min-h-12 items-center justify-between gap-3 px-4 text-left disabled:opacity-50"
    disabled={busy || card?.isSelf}
    {onclick}
  >
    <span>{text}</span>
    {#if hint}<span class="text-xs text-gray-light">{hint}</span>{/if}
  </button>
{/snippet}

<main class="min-h-app pb-10">
  {#if failure}
    <PageHeader
      title={failure === 'forbidden' ? 'Раздел только для модераторов' : 'Пользователь не найден'}
    />
    <div class="px-5 pt-4">
      <a href="/admin" class="inline-block rounded-2xl bg-brand px-6 py-3 text-lg font-bold text-paper"
        >К очереди</a
      >
    </div>
  {:else if !card}
    <PageHeader title="Пользователь" />
    <div class="flex flex-col gap-3 px-5 pt-4">
      {#if loadError}
        <ErrorState title="Не удалось загрузить карточку" message={loadError} onretry={() => void load()} />
      {:else}
        <div class="h-20 animate-pulse rounded-3xl bg-gray-dark/40" aria-busy="true"></div>
        <div class="h-40 animate-pulse rounded-3xl bg-gray-dark/40"></div>
      {/if}
    </div>
  {:else}
    {@const user = card.user}
    <PageHeader eyebrow="Модерация" title={user.firstName} subtitle="В MASL с {formatDay(user.joinedAt)}" />

    <div class="flex flex-col gap-5 px-5 pt-5">
      <SubjectCard {user} />
      <UserStats stats={card.stats} />

      {#if card.block}
        <section
          class="flex flex-col gap-1.5 rounded-[1.125rem] border border-brand-light/60 bg-brand-deep/10 px-4 py-3.5 text-sm"
        >
          <span class="font-semibold"
            >{CREATION_BLOCKED_TITLES[card.block.kind]}, с {formatDay(card.block.since)}</span
          >
          {#if blockCause(card.block)}<span class="text-paper/85">{blockCause(card.block)}</span>{/if}
        </section>
      {/if}

      {#if card.openCases.length > 0}
        <section class="flex flex-col gap-2.5" aria-labelledby="open-cases-title">
          <h2 id="open-cases-title" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
            Открытые дела
          </h2>
          {#each card.openCases as item (item.id)}
            <a
              href="/admin/case/{item.id}"
              class="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4"
            >
              <span>{CASE_KIND_LABELS[item.kind]}</span>
              <span class="flex items-center gap-2 text-sm text-gray-light">
                {formatTimeAgo(item.openedAt, clock.now)}
                <ChevronRight size={18} />
              </span>
            </a>
          {/each}
        </section>
      {/if}

      <section class="flex flex-col gap-2.5" aria-labelledby="actions-title">
        <h2 id="actions-title" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
          Действия
        </h2>
        {#if card.isSelf}
          <p class="text-sm text-gray-light" role="status">Свою карму и флаги меняет другой модератор.</p>
        {/if}
        <div
          class="flex flex-col divide-y divide-gray-dark rounded-2xl border border-gray-dark bg-gray-dark/40"
        >
          {@render actionButton(
            'Изменить карму',
            openKarma,
            `±${MODERATION_KARMA_DELTA_MAX}, с комментарием`,
          )}
          {#if user.isShadowBanned}
            {@render actionButton('Снять теневой бан', () => void flag('lift_shadow_ban'))}
          {:else}
            {@render actionButton('Включить теневой бан', () => void flag('shadow_ban'))}
          {/if}
          {#if user.creationBlock}
            {@render actionButton('Разрешить создавать встречи', () => void flag('unblock_creation'))}
          {:else}
            {@render actionButton('Запретить создавать встречи', () => void flag('block_creation'))}
          {/if}
          {#if card.viewerIsAdmin && user.role !== 'admin'}
            {#if user.role === 'moderator'}
              {@render actionButton(
                'Снять с модераторов',
                () => void flag('revoke_moderator'),
                'только админ',
              )}
            {:else}
              {@render actionButton(
                'Сделать модератором',
                () => void flag('grant_moderator'),
                'только админ',
              )}
            {/if}
          {/if}
        </div>
      </section>

      <ModerationHistory items={card.history} />
    </div>

    <Sheet name="moderation-action" title="Изменить карму">
      <form
        class="flex flex-col gap-4"
        onsubmit={(event) => {
          event.preventDefault();
          void changeKarma();
        }}
      >
        <p class="text-sm text-gray-light">{user.firstName}: карма {user.karma}.</p>
        <Segmented
          label="Изменение"
          bind:value={sign}
          options={[
            { value: -1, label: 'Снять' },
            { value: 1, label: 'Добавить' },
          ]}
        />
        <label class="flex flex-col gap-2">
          <span class="text-sm text-gray-light">Сколько, от 1 до {MODERATION_KARMA_DELTA_MAX}</span>
          <input
            bind:value={amount}
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="2"
            aria-invalid={tried && !amountValid ? true : undefined}
            class="min-h-12 rounded-2xl border bg-gray-dark/40 px-4 text-base text-paper {tried &&
            !amountValid
              ? 'border-brand-light'
              : 'border-gray-dark'}"
          />
          {#if tried && !amountValid}
            <span class="text-xs text-brand-light" role="alert"
              >Укажите число от 1 до {MODERATION_KARMA_DELTA_MAX}</span
            >
          {/if}
        </label>
        <label class="flex flex-col gap-2">
          <span class="text-sm text-gray-light">За что. Пользователь увидит это в истории кармы</span>
          <textarea
            bind:value={karmaComment}
            rows="3"
            maxlength={MODERATION_COMMENT_MAX}
            aria-invalid={tried && !commentValid ? true : undefined}
            class="resize-none rounded-2xl border bg-gray-dark/40 px-4 py-3 text-base text-paper {tried &&
            !commentValid
              ? 'border-brand-light'
              : 'border-gray-dark'}"
          ></textarea>
          <span class="flex justify-between gap-3 text-xs text-gray-light">
            <span class="text-brand-light" role={tried && !commentValid ? 'alert' : undefined}>
              {tried && !commentValid ? 'Напишите, за что меняется карма' : ''}
            </span>
            <span>{karmaComment.length} / {MODERATION_COMMENT_MAX}</span>
          </span>
        </label>
        <button
          type="submit"
          class="min-h-12 rounded-2xl bg-brand text-lg font-bold text-paper disabled:opacity-50"
          disabled={busy}
          aria-busy={busy}
        >
          {busy
            ? 'Сохраняем…'
            : amountValid
              ? `Изменить карму на ${formatKarmaDelta(sign * delta)}`
              : 'Изменить карму'}
        </button>
      </form>
    </Sheet>
  {/if}
</main>
