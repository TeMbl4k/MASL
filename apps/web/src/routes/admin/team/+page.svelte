<script lang="ts">
  import {
    LINK_TAG_SLUG_MAX,
    LINK_TAG_TITLE_MAX,
    normalizeSingleLine,
    USER_SEARCH_MAX,
    USER_SEARCH_MIN,
    type AdminUserDto,
    type LinkTagDto,
    type TeamMemberDto,
  } from '@masl/shared';
  import { onDestroy, untrack } from 'svelte';
  import { page } from '$app/state';
  import { api, ApiError } from '#lib/api.js';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import Copy from '#lib/components/icons/Copy.svelte';
  import Qr from '#lib/components/icons/Qr.svelte';
  import Search from '#lib/components/icons/Search.svelte';
  import AdminTabs from '#lib/components/moderation/AdminTabs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import QrImage from '#lib/components/QrImage.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatShortDate } from '#lib/format/datetime.js';
  import { ROLE_LABELS } from '#lib/format/labels.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet, openSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { copyText } from '#lib/tg/links.js';
  import { confirm } from '#lib/tg/popup.js';

  const SEARCH_DEBOUNCE_MS = 300;

  let team = $state<TeamMemberDto[] | null>(null);
  let tags = $state<LinkTagDto[] | null>(null);
  let forbidden = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let busy = $state(false);

  let query = $state('');
  let found = $state<AdminUserDto[] | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchController: AbortController | null = null;
  const searchText = $derived(normalizeSingleLine(query).slice(0, USER_SEARCH_MAX));
  const searching = $derived(searchText.length >= USER_SEARCH_MIN);

  let slug = $state('');
  let title = $state('');

  /** The tag of the open QR sheet. */
  const qrTag = $derived(
    page.state.sheet === 'tag-qr' ? (tags?.find((tag) => tag.id === page.state.tagId) ?? null) : null,
  );
  let printing = $state(false);

  onDestroy(() => {
    clearTimeout(searchTimer);
    searchController?.abort();
  });

  function fail(error: unknown): void {
    if (error instanceof ApiError && error.status === 403) {
      forbidden = error.message;
      return;
    }
    const shown = describeError(error);
    if (shown.kind === 'update' || team) toast.error(error);
    else loadError = shown.text;
  }

  async function load(): Promise<void> {
    try {
      const [nextTeam, nextTags] = await session.authorized((token) =>
        Promise.all([api.adminTeam(token), api.linkTags(token)]),
      );
      team = nextTeam.items;
      tags = nextTags.items;
      loadError = null;
    } catch (error) {
      fail(error);
    }
  }

  $effect(() => {
    if (appActivity.active) untrack(() => void load());
  });

  function oninput(): void {
    clearTimeout(searchTimer);
    searchController?.abort();
    if (!searching) {
      found = null;
      return;
    }
    const text = searchText;
    searchTimer = setTimeout(async () => {
      const current = (searchController = new AbortController());
      try {
        found = (await session.authorized((token) => api.adminUsers(token, text, current.signal))).items;
      } catch (error) {
        if (!isAbort(error)) toast.error(error);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  async function setModerator(userId: string, firstName: string, grant: boolean): Promise<void> {
    if (busy) return;
    const confirmed = await confirm(
      grant
        ? {
            title: `Сделать ${firstName} модератором?`,
            message: 'Откроется раздел «Модерация», бот начнёт присылать новые дела.',
            confirmText: 'Назначить',
          }
        : {
            title: `Снять ${firstName} с модераторов?`,
            message: 'Раздел «Модерация» закроется сразу.',
            confirmText: 'Снять',
            destructive: true,
          },
    );
    if (!confirmed) return;
    busy = true;
    try {
      await session.authorized((token) =>
        api.userAction(token, userId, {
          action: grant ? 'grant_moderator' : 'revoke_moderator',
          karmaDelta: null,
          comment: null,
        }),
      );
      haptic.success();
      toast.show('Готово', 'success');
      query = '';
      found = null;
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
      void load();
    }
  }

  async function createTag(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      tags = (await session.authorized((token) => api.createLinkTag(token, { slug, title }))).items;
      haptic.success();
      toast.show('Метка создана', 'success');
      slug = '';
      title = '';
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
    }
  }

  async function printTag(id: number): Promise<void> {
    if (printing) return;
    printing = true;
    try {
      await session.authorized((token) => api.printTag(token, id));
      haptic.success();
      toast.show('Бот прислал файл в чат', 'success');
      closeSheet();
    } catch (error) {
      toast.error(error);
    } finally {
      printing = false;
    }
  }

  async function copy(link: string): Promise<void> {
    if (await copyText(link)) {
      haptic.success();
      toast.show('Ссылка скопирована', 'success');
    } else {
      toast.show(link, 'info', 8000);
    }
  }
</script>

<svelte:head>
  <title>Команда и метки — MASL</title>
</svelte:head>

{#snippet heading(text: string)}
  <h2 class="text-[0.8125rem] tracking-widest text-gray-light uppercase">{text}</h2>
{/snippet}

<main class="min-h-app pb-10">
  <PageHeader title="Команда и метки" />
  <div class="flex flex-col gap-5 px-5 pt-5">
    <AdminTabs />
    {#if forbidden}
      <EmptyState title="Раздел только для админов" text={forbidden} />
    {:else if !team && loadError}
      <ErrorState title="Не удалось загрузить" message={loadError} onretry={() => void load()} />
    {:else if !team || !tags}
      <div class="flex flex-col gap-2.5" aria-busy="true">
        <div class="h-16 animate-pulse rounded-2xl bg-gray-dark/40"></div>
        <div class="h-16 animate-pulse rounded-2xl bg-gray-dark/40"></div>
      </div>
    {:else}
      <section class="flex flex-col gap-2.5">
        {@render heading('Команда')}
        <ul class="flex flex-col gap-2">
          {#each team as member (member.telegramId)}
            <li
              class="flex min-h-14 items-center gap-3 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-2.5"
            >
              <span class="flex min-w-0 flex-1 flex-col">
                {#if member.user}
                  <a href="/admin/user/{member.user.id}" class="truncate font-semibold">
                    {member.user.firstName}{#if member.user.username}
                      <span class="font-normal text-gray-light">@{member.user.username}</span>{/if}
                  </a>
                {:else}
                  <span class="font-semibold">Telegram ID {member.telegramId}</span>
                {/if}
                <span class="text-[0.8125rem] text-gray-light">
                  {ROLE_LABELS[member.role]}{#if member.role === 'admin'}{' · '}из настроек сервера{#if !member.user}{', ещё не заходил'}{/if}{:else if member.since}{' · '}с
                    {formatShortDate(member.since)}{/if}
                </span>
              </span>
              {#if member.role === 'moderator' && member.user}
                {@const user = member.user}
                <button
                  type="button"
                  class="min-h-10 rounded-xl border border-brand-deep/70 px-3 text-sm text-brand-light disabled:opacity-50"
                  disabled={busy}
                  onclick={() => void setModerator(user.id, user.firstName, false)}
                >
                  Снять
                </button>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="text-[0.8125rem] text-gray-light">
          Админы задаются только в настройках сервера (ADMIN_TELEGRAM_IDS).
        </p>

        <label class="relative block">
          <span class="sr-only">Найти, кого назначить модератором</span>
          <Search
            size={18}
            class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-light"
          />
          <input
            bind:value={query}
            type="search"
            autocomplete="off"
            enterkeyhint="search"
            maxlength={USER_SEARCH_MAX}
            placeholder="Назначить: @username, имя или ID"
            class="min-h-12 w-full rounded-2xl border border-gray-dark bg-gray-dark/40 pr-4 pl-11 text-base text-paper placeholder:text-gray"
            {oninput}
          />
        </label>
        {#if searching && found}
          {#if found.length === 0}
            <p class="text-sm text-gray-light">Никого не нашли</p>
          {:else}
            <ul class="flex flex-col gap-2">
              {#each found as user (user.id)}
                <li class="flex min-h-12 items-center gap-3 rounded-2xl border border-gray-dark px-4 py-2">
                  <span class="min-w-0 flex-1 truncate">
                    {user.firstName}{#if user.username}
                      <span class="text-gray-light">@{user.username}</span>{/if}
                  </span>
                  {#if user.role === 'user'}
                    <button
                      type="button"
                      class="min-h-10 rounded-xl bg-brand px-3 text-sm font-semibold text-paper disabled:opacity-50"
                      disabled={busy}
                      onclick={() => void setModerator(user.id, user.firstName, true)}
                    >
                      Назначить
                    </button>
                  {:else}
                    <span class="text-sm text-gray-light">{ROLE_LABELS[user.role]}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      <section class="flex flex-col gap-2.5">
        {@render heading('Метки ссылок')}
        <p class="text-[0.8125rem] leading-relaxed text-gray-light">
          Ссылка с меткой открывает ленту. Новые пользователи, пришедшие по ней, видны в статистике.
        </p>
        <form
          class="flex flex-col gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            void createTag();
          }}
        >
          <input
            bind:value={slug}
            autocomplete="off"
            autocapitalize="none"
            maxlength={LINK_TAG_SLUG_MAX}
            placeholder="Метка: channel-oct"
            aria-label="Метка: латиница, цифры и дефис"
            class="min-h-12 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 text-base text-paper placeholder:text-gray"
          />
          <input
            bind:value={title}
            autocomplete="off"
            maxlength={LINK_TAG_TITLE_MAX}
            placeholder="Название: Пост в канале, октябрь"
            aria-label="Название"
            class="min-h-12 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 text-base text-paper placeholder:text-gray"
          />
          <button
            type="submit"
            class="min-h-11 self-start rounded-xl bg-brand px-5 font-semibold text-paper disabled:opacity-50"
            disabled={busy || !slug.trim() || !title.trim()}
          >
            Создать метку
          </button>
        </form>
        {#if tags.length === 0}
          <p class="text-sm text-gray-light">Меток пока нет</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each tags as tag (tag.id)}
              <li
                class="flex items-center gap-3 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-2.5"
              >
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate font-semibold">{tag.title}</span>
                  <span class="text-[0.8125rem] text-gray-light">
                    {tag.slug} · пришли {tag.arrivals}{#if tag.arrivals > 0}, до встречи {tag.attended}{/if}
                  </span>
                </span>
                {#if tag.link}
                  {@const link = tag.link}
                  <button
                    type="button"
                    aria-label="Скопировать ссылку метки {tag.title}"
                    class="flex size-11 items-center justify-center rounded-xl border border-gray-dark"
                    onclick={() => void copy(link)}
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="QR метки {tag.title}"
                    class="flex size-11 items-center justify-center rounded-xl border border-gray-dark"
                    onclick={() => void openSheet('tag-qr', { tagId: tag.id })}
                  >
                    <Qr size={18} />
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>
</main>

<Sheet name="tag-qr" title={qrTag?.title ?? 'QR метки'}>
  {#if qrTag?.link}
    {@const tag = qrTag}
    {@const link = qrTag.link}
    <div class="flex flex-col items-center gap-3.5">
      <QrImage text={link} size={200} label="QR-код ссылки метки {tag.title}" />
      <p class="text-center text-[0.8125rem] text-gray-light">
        Ведёт в ленту, новые люди записываются на эту метку
      </p>
      <div class="grid grid-cols-2 gap-2.5 self-stretch">
        <button
          type="button"
          class="min-h-13 rounded-2xl border border-gray-dark bg-gray-dark/40 text-[0.9375rem]"
          onclick={() => void copy(link)}
        >
          Скопировать ссылку
        </button>
        <button
          type="button"
          class="min-h-13 rounded-2xl bg-brand text-[0.9375rem] font-semibold text-paper disabled:opacity-60"
          disabled={printing}
          aria-busy={printing}
          onclick={() => void printTag(tag.id)}
        >
          Прислать для печати
        </button>
      </div>
    </div>
  {:else}
    <p class="text-sm text-gray-light">Метка не найдена</p>
  {/if}
</Sheet>
