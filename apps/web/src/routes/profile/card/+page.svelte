<script lang="ts">
  import type { ShareResponse } from '@masl/shared';
  import { shareMessage } from '@telegram-apps/sdk';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import Copy from '#lib/components/icons/Copy.svelte';
  import Printer from '#lib/components/icons/Printer.svelte';
  import Upload from '#lib/components/icons/Upload.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import QrImage from '#lib/components/QrImage.svelte';
  import { describeError } from '#lib/errors.js';
  import { ACHIEVEMENT_FORMS, plural } from '#lib/format/plural.js';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { copyText } from '#lib/tg/links.js';

  const user = $derived(session.state.status === 'ready' ? session.state.user : null);

  let shared = $state<ShareResponse | null>(null);
  let earned = $state<number | null>(null);
  let loadError = $state<string | null>(null);
  let printing = $state(false);

  async function load(): Promise<void> {
    if (!user) return;
    loadError = null;
    const code = user.publicCode;
    try {
      shared = await session.authorized((token) => api.share(token, { kind: 'profile', code }));
    } catch (error) {
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
    }
  }

  onMount(() => {
    void load();
    // Only the count on the card depends on it.
    session
      .authorized((token) => api.myAchievements(token))
      .then(
        (mine) => (earned = mine.items.filter((item) => item.earnedAt !== null).length),
        () => undefined,
      );
  });

  const canSend = $derived(
    shared?.preparedMessageId != null && session.inTelegram && shareMessage.isAvailable(),
  );

  async function share(): Promise<void> {
    const id = shared?.preparedMessageId;
    if (!canSend || !id) {
      await copy();
      return;
    }
    try {
      await shareMessage(id);
      haptic.success();
    } catch {
      // Closed the chat picker: nothing to do.
    }
  }

  async function copy(): Promise<void> {
    if (!shared) return;
    if (await copyText(shared.link)) {
      haptic.success();
      toast.show('Ссылка скопирована', 'success');
    } else {
      toast.show(shared.link, 'info', 8000);
    }
  }

  async function print(): Promise<void> {
    if (printing) return;
    printing = true;
    try {
      const result = await session.authorized((token) => api.printCard(token));
      haptic.success();
      toast.show(
        result.left === null
          ? 'Бот прислал файл в чат'
          : `Бот прислал файл в чат. Сегодня можно ещё ${result.left}`,
        'success',
      );
    } catch (error) {
      toast.error(error);
    } finally {
      printing = false;
    }
  }
</script>

<svelte:head>
  <title>Моя визитка — MASL</title>
</svelte:head>

<main class="bg-card-screen min-h-app pb-10">
  <PageHeader title="Моя визитка">
    {#snippet heading()}Моя <span class="font-semibold italic">визитка</span>{/snippet}
  </PageHeader>
  {#if user}
    <div class="flex flex-col gap-4 px-5 pt-5">
      <section
        class="flex flex-col items-center gap-4 rounded-[1.75rem] bg-paper px-5 pt-6 pb-5 text-ink"
        aria-label="Визитка"
      >
        <div class="flex items-center gap-3 self-stretch">
          <Avatar name={user.firstName} src={user.photoUrl} size={48} />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-xl font-semibold">{user.firstName}</span>
            <span class="text-[0.8125rem] text-gray">
              Карма {user.karma}{#if earned}{' · '}{plural(earned, ACHIEVEMENT_FORMS)}{/if}
            </span>
          </div>
          <span class="text-[0.9375rem] font-extrabold tracking-wider text-brand-deep">MASL</span>
        </div>
        {#if shared}
          <QrImage text={shared.link} size={232} label="QR-код ссылки на ваш профиль" />
        {:else if loadError}
          <ErrorState title="Не удалось подготовить ссылку" message={loadError} onretry={() => void load()} />
        {:else}
          <div class="size-58 animate-pulse rounded-xl bg-gray-light/40" aria-busy="true"></div>
        {/if}
        <p class="text-center text-[1.0625rem] font-semibold">Найди компанию на сегодняшний вечер</p>
        <p class="text-center text-[0.8125rem] text-gray">Наведите камеру телефона на код</p>
      </section>

      <div class="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-paper/20 bg-ink/55 disabled:opacity-50"
          disabled={!shared}
          onclick={() => void share()}
        >
          <Upload size={18} />Поделиться
        </button>
        <button
          type="button"
          class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-paper/20 bg-ink/55 disabled:opacity-50"
          disabled={!shared}
          onclick={() => void copy()}
        >
          <Copy size={18} />Скопировать
        </button>
      </div>
      <button
        type="button"
        class="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-ink text-[1.0625rem] font-semibold disabled:opacity-60"
        disabled={printing}
        aria-busy={printing}
        onclick={() => void print()}
      >
        <Printer size={20} />Прислать для печати
      </button>
      <p class="text-center text-[0.8125rem] text-paper/85">
        Бот пришлёт QR файлом SVG: его можно отдать в типографию.
      </p>
    </div>
  {/if}
</main>
