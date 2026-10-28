<script lang="ts">
  import {
    KARMA,
    LOBBY_MIN_KARMA_PRESETS,
    LOBBY_SLOTS_MAX,
    LOBBY_SLOTS_MIN,
    LOBBY_SLOTS_PRESETS,
    normalizeSingleLine,
    PAYMENT_FORMATS,
  } from '@masl/shared';
  import { onMount } from 'svelte';
  import { PAYMENT_FORMAT_LABELS } from '#lib/format/labels.js';
  import { session } from '#lib/session.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import type { LobbyDraft } from '#lib/wizard/draft.svelte.js';
  import type { StepIssues } from '#lib/wizard/validate.js';
  import LobbyCard from '../LobbyCard.svelte';
  import LobbyCardSkeleton from '../LobbyCardSkeleton.svelte';
  import Segmented from './Segmented.svelte';
  import Stepper from './Stepper.svelte';

  interface Props {
    draft: LobbyDraft;
    /** Shown only after an «Опубликовать» attempt. */
    issues: StepIssues;
  }

  let { draft, issues }: Props = $props();

  const id = $props.id();

  onMount(() => {
    void draft.loadMetro();
  });

  const karmaOptions = LOBBY_MIN_KARMA_PRESETS.map((value) => ({
    value: value as number,
    label: String(value),
  }));
  const paymentOptions = PAYMENT_FORMATS.map((value) => ({ value, label: PAYMENT_FORMAT_LABELS[value] }));

  const user = $derived(session.state.status === 'ready' ? session.state.user : null);
  const preview = $derived(
    user
      ? draft.previewCard(
          { code: user.publicCode, firstName: user.firstName, photoUrl: user.photoUrl, karma: user.karma },
          normalizeSingleLine(draft.title),
        )
      : null,
  );

  const karmaHint = $derived.by(() => {
    if (!draft.minKarmaOn) {
      return `Выключено: заявку может подать любой. У новичков карма ${KARMA.START}.`;
    }
    if (draft.minKarma > KARMA.START) {
      return `Карма выше ${KARMA.START} бывает только у тех, кто уже приходил на встречи. Пока таких участников почти нет — встреча может остаться пустой.`;
    }
    return `Заявку смогут подать участники с кармой от ${draft.minKarma}.`;
  });

  function toggleKarma() {
    haptic.select();
    draft.minKarmaOn = !draft.minKarmaOn;
  }

  function setSlots(value: number) {
    if (value === draft.slots) return;
    haptic.select();
    draft.slots = value;
  }
</script>

<section class="flex flex-col gap-3" aria-labelledby="{id}-slots">
  <div class="flex items-center justify-between gap-3">
    <h2 id="{id}-slots" class="text-[0.9375rem] leading-snug">Сколько человек нужно,<br />кроме вас</h2>
    <Stepper
      bind:value={draft.slots}
      min={LOBBY_SLOTS_MIN}
      max={LOBBY_SLOTS_MAX}
      label="Сколько человек нужно"
    />
  </div>
  <div class="flex flex-wrap gap-2" role="group" aria-label="Быстрый выбор">
    {#each LOBBY_SLOTS_PRESETS as value (value)}
      {@const pressed = draft.slots === value}
      <button
        type="button"
        aria-pressed={pressed}
        class="min-h-11 min-w-11 rounded-full border px-3 text-sm transition {pressed
          ? 'border-brand bg-brand/20 font-semibold text-paper'
          : 'border-gray-dark bg-gray-dark/40 text-paper'}"
        onclick={() => setSlots(value)}
      >
        {value}
      </button>
    {/each}
  </div>
  {#if issues.slots}
    <p class="text-sm text-brand-light" role="alert">{issues.slots}</p>
  {/if}
</section>

<section class="flex flex-col gap-2.5">
  <!-- The whole row is the switch: a tap target taller than the 32 px track. -->
  <button
    type="button"
    role="switch"
    aria-checked={draft.minKarmaOn}
    class="flex min-h-11 items-center justify-between gap-3 text-left"
    onclick={toggleKarma}
  >
    <span class="text-[0.9375rem]">Только с кармой от</span>
    <span
      aria-hidden="true"
      class="flex h-8 w-13 shrink-0 items-center rounded-full p-[3px] transition {draft.minKarmaOn
        ? 'bg-brand'
        : 'bg-gray-dark'}"
    >
      <span
        class="size-[1.625rem] rounded-full transition-transform {draft.minKarmaOn
          ? 'translate-x-5 bg-paper'
          : 'bg-gray-light'}"
      ></span>
    </span>
  </button>
  <Segmented
    options={karmaOptions}
    bind:value={draft.minKarma}
    label="Минимальная карма"
    disabled={!draft.minKarmaOn}
    look="grid"
  />
  <p
    class="text-[0.8125rem] leading-snug {draft.minKarmaOn && draft.minKarma > KARMA.START
      ? 'text-sand'
      : 'text-gray-light'}"
  >
    {karmaHint}
  </p>
  {#if issues.minKarma}
    <p class="text-sm text-brand-light" role="alert">{issues.minKarma}</p>
  {/if}
</section>

<section class="flex flex-col gap-2.5">
  <span class="text-[0.9375rem]">Как платим</span>
  <Segmented options={paymentOptions} bind:value={draft.paymentFormat} label="Как платим" />
  {#if draft.paymentFormat === 'split'}
    <p class="text-[0.8125rem] leading-snug text-gray-light">
      Каждый платит за себя или делим поровну — договоритесь на месте.
    </p>
  {/if}
</section>

<section class="flex flex-col gap-2.5 pb-4" aria-labelledby="{id}-preview">
  <h2 id="{id}-preview" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
    Так встречу увидят в ленте
  </h2>
  {#if preview}
    <LobbyCard lobby={preview} variant="featured" href={null} />
  {:else}
    <LobbyCardSkeleton />
  {/if}
</section>
