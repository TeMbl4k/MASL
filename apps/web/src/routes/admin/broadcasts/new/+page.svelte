<script lang="ts">
  import {
    BROADCAST_TEXT_MAX,
    BROADCAST_TEXT_MIN,
    effectiveLobbyStatus,
    lobbyIdFromLink,
    type BroadcastAudienceDto,
    type BroadcastInput,
  } from '@masl/shared';
  import { onDestroy, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '#lib/api.js';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import Segmented from '#lib/components/wizard/Segmented.svelte';
  import { isAbort } from '#lib/errors.js';
  import { formatLobbyStart } from '#lib/format/datetime.js';
  import { session } from '#lib/session.svelte.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { confirm } from '#lib/tg/popup.js';

  const AUDIENCE_DEBOUNCE_MS = 300;

  let text = $state('');
  let to = $state<'all' | 'interests'>('all');
  let interests = $state<string[]>([]);
  let button = $state<'app' | 'lobby'>('app');
  let link = $state('');
  let lobby = $state<{ id: string; label: string } | null>(null);
  let lobbyError = $state<string | null>(null);
  let audience = $state<BroadcastAudienceDto | null>(null);
  let busy = $state(false);

  const length = $derived(text.trim().length);
  const input = $derived<BroadcastInput>({
    text: text.trim(),
    interests: to === 'interests' ? interests : null,
    lobbyId: button === 'lobby' ? (lobby?.id ?? null) : null,
  });
  const ready = $derived(
    length >= BROADCAST_TEXT_MIN &&
      length <= BROADCAST_TEXT_MAX &&
      (to === 'all' || interests.length > 0) &&
      (button === 'app' || lobby !== null),
  );

  // «Получат N» follows the audience choice.
  let audienceTimer: ReturnType<typeof setTimeout> | undefined;
  let audienceController: AbortController | null = null;
  $effect(() => {
    const chosen = to === 'interests' ? [...interests] : null;
    untrack(() => {
      clearTimeout(audienceTimer);
      audienceController?.abort();
      if (chosen?.length === 0) {
        audience = null;
        return;
      }
      audienceTimer = setTimeout(async () => {
        const current = (audienceController = new AbortController());
        try {
          audience = await session.authorized((token) =>
            api.broadcastAudience(token, chosen, current.signal),
          );
        } catch (error) {
          if (!isAbort(error)) toast.error(error);
        }
      }, AUDIENCE_DEBOUNCE_MS);
    });
  });

  onDestroy(() => {
    clearTimeout(audienceTimer);
    audienceController?.abort();
  });

  function toggleInterest(slug: string): void {
    haptic.select();
    interests = interests.includes(slug) ? interests.filter((s) => s !== slug) : [...interests, slug];
  }

  async function findLobby(): Promise<void> {
    lobby = null;
    lobbyError = null;
    if (!link.trim()) return;
    const id = lobbyIdFromLink(link);
    if (!id) {
      lobbyError = 'Это не ссылка на встречу. Скопируйте её в «Поделиться» на странице встречи.';
      return;
    }
    try {
      const found = await session.authorized((token) => api.lobby(token, id));
      if (effectiveLobbyStatus(found, clock.now) !== 'open') {
        lobbyError = 'Эта встреча уже не набирает участников.';
        return;
      }
      lobby = { id, label: `${found.title} · ${formatLobbyStart(found.startsAt, clock.now)}` };
    } catch (error) {
      lobbyError = error instanceof Error ? error.message : 'Встреча не найдена';
    }
  }

  async function sendTest(): Promise<void> {
    if (busy || !ready) return;
    busy = true;
    try {
      await session.authorized((token) => api.testBroadcast(token, input));
      haptic.success();
      toast.show('Бот прислал вам рассылку', 'success');
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
    }
  }

  async function send(): Promise<void> {
    if (busy || !ready || !audience) return;
    const confirmed = await confirm({
      title: `Отправить рассылку ${audience.recipients}?`,
      message: 'Сообщение уйдёт от бота, отменить его будет нельзя.',
      confirmText: 'Отправить',
    });
    if (!confirmed) return;
    busy = true;
    try {
      await session.authorized((token) => api.sendBroadcast(token, input));
      haptic.success();
      toast.show('Рассылка отправляется', 'success');
      await goto('/admin/broadcasts', { replaceState: true });
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Новая рассылка — MASL</title>
</svelte:head>

{#snippet caption(label: string)}
  <span class="text-[0.8125rem] tracking-widest text-gray-light uppercase">{label}</span>
{/snippet}

<main class="min-h-app pb-10">
  <PageHeader title="Новая рассылка">
    {#snippet heading()}Новая <span class="font-semibold italic">рассылка</span>{/snippet}
  </PageHeader>
  <div class="flex flex-col gap-5 px-5 pt-5">
    <label class="flex flex-col gap-2">
      {@render caption('Текст')}
      <textarea
        bind:value={text}
        rows="6"
        maxlength={BROADCAST_TEXT_MAX}
        placeholder="Что нового в MASL"
        class="w-full resize-none rounded-2xl border border-gray-dark bg-gray-dark/40 p-3.5 text-base leading-relaxed text-paper placeholder:text-gray"
      ></textarea>
      <span class="self-end text-xs text-gray-light">{length} / {BROADCAST_TEXT_MAX}</span>
    </label>
    <p class="-mt-3 text-xs text-gray-light">Простой текст, без разметки: звёздочки и теги уйдут как есть.</p>

    <fieldset class="flex flex-col gap-2.5">
      <legend class="mb-2.5">{@render caption('Кому')}</legend>
      <Segmented
        label="Кому"
        bind:value={to}
        options={[
          { value: 'all', label: 'Всем' },
          { value: 'interests', label: 'По интересам' },
        ]}
      />
      {#if to === 'interests'}
        <ul class="flex flex-wrap gap-2">
          {#each session.interests as interest (interest.slug)}
            {@const on = interests.includes(interest.slug)}
            <li>
              <button
                type="button"
                aria-pressed={on}
                class="min-h-10 rounded-full border px-3.5 text-sm {on
                  ? 'border-brand bg-brand/20'
                  : 'border-gray-dark bg-gray-dark/40'}"
                onclick={() => toggleInterest(interest.slug)}
              >
                {interest.emoji}
                {interest.title}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </fieldset>

    <fieldset class="flex flex-col gap-2.5">
      <legend class="mb-2.5">{@render caption('Кнопка')}</legend>
      <Segmented
        label="Кнопка"
        bind:value={button}
        options={[
          { value: 'app', label: 'Открыть MASL' },
          { value: 'lobby', label: 'Открыть встречу' },
        ]}
      />
      {#if button === 'lobby'}
        <input
          bind:value={link}
          type="url"
          autocomplete="off"
          aria-label="Ссылка на встречу"
          placeholder="Ссылка из «Поделиться» на встрече"
          class="min-h-12 rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 text-base text-paper placeholder:text-gray"
          onchange={() => void findLobby()}
          onpaste={() => setTimeout(() => void findLobby())}
        />
        {#if lobby}
          <p class="text-sm">{lobby.label}</p>
        {:else if lobbyError}
          <p class="text-sm text-brand-light" role="alert">{lobbyError}</p>
        {:else}
          <p class="text-xs text-gray-light">
            Вставьте ссылку из «Поделиться» на встрече: подставится её название.
          </p>
        {/if}
      {/if}
    </fieldset>

    {#if audience}
      {@const skipped = audience.skipped}
      <section
        class="flex flex-col gap-2 rounded-2xl border border-gray-dark bg-linear-135 from-brand/15 to-gray-dark/40 to-70% p-3.5"
        aria-live="polite"
      >
        <p class="text-[1.625rem] font-light">Получат <b class="font-semibold">{audience.recipients}</b></p>
        {#if skipped.unsubscribed + skipped.botBlocked + skipped.recent > 0}
          <p class="text-[0.8125rem] leading-relaxed text-gray-light">
            Пропустим {skipped.unsubscribed + skipped.botBlocked + skipped.recent}: отписались от новостей
            {skipped.unsubscribed}, боту нельзя писать {skipped.botBlocked}, уже получали рассылку за
            последние сутки
            {skipped.recent}.
          </p>
        {/if}
      </section>
    {/if}

    <div class="flex flex-col gap-2.5">
      <button
        type="button"
        class="min-h-12 rounded-2xl border border-gray-dark bg-gray-dark/40 disabled:opacity-50"
        disabled={busy || !ready}
        onclick={() => void sendTest()}
      >
        Отправить себе для проверки
      </button>
      <button
        type="button"
        class="min-h-14 rounded-2xl bg-brand text-xl font-bold text-paper disabled:opacity-50"
        disabled={busy || !ready || !audience || audience.recipients === 0}
        aria-busy={busy}
        onclick={() => void send()}
      >
        {audience ? `Отправить ${audience.recipients}` : 'Отправить'}
      </button>
      <p class="text-center text-xs text-gray-light">Перед отправкой спросим подтверждение</p>
    </div>
  </div>
</main>
