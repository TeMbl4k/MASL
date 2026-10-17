<script lang="ts">
  import {
    LOBBY_CATEGORIES,
    LOBBY_CATEGORY_INFO,
    LOBBY_DESCRIPTION_MAX,
    LOBBY_TITLE_MAX,
    type LobbyCategory,
  } from '@masl/shared';
  import { haptic } from '#lib/tg/haptics.js';
  import type { LobbyDraft } from '#lib/wizard/draft.svelte.js';
  import {
    DESCRIPTION_PLACEHOLDER,
    EXACT_ADDRESS_HINT,
    TITLE_PLACEHOLDER_DEFAULT,
    TITLE_PLACEHOLDERS,
  } from '#lib/wizard/placeholders.js';
  import type { StepIssues } from '#lib/wizard/validate.js';
  import { radioKeyTarget } from '../radio-group.js';

  interface Props {
    draft: LobbyDraft;
    /** Shown only after a «Далее» attempt. */
    issues: StepIssues;
  }

  let { draft, issues }: Props = $props();

  /** Counters appear close to the limit. */
  const TITLE_COUNTER_FROM = 60;
  const DESCRIPTION_COUNTER_FROM = 800;

  const id = $props.id();
  let tiles: HTMLButtonElement[] = $state([]);
  const focusIndex = $derived(Math.max(0, draft.category ? LOBBY_CATEGORIES.indexOf(draft.category) : 0));

  function select(category: LobbyCategory) {
    if (draft.category === category) return;
    haptic.select();
    draft.category = category;
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    const target = radioKeyTarget(event.key, index, LOBBY_CATEGORIES.length);
    if (target === null) return;
    event.preventDefault();
    select(LOBBY_CATEGORIES[target]);
    tiles[target]?.focus();
  }

  const inputClass = (invalid: boolean) =>
    `w-full rounded-2xl border bg-gray-dark/40 px-4 py-3.5 text-paper placeholder:text-gray ${
      invalid ? 'border-brand-light' : 'border-gray-dark'
    }`;
</script>

<section class="flex flex-col gap-2" aria-labelledby="{id}-category">
  <h2 id="{id}-category" class="sr-only">Категория</h2>
  <div
    role="radiogroup"
    aria-labelledby="{id}-category"
    aria-invalid={issues.category ? true : undefined}
    aria-describedby={issues.category ? `${id}-category-error` : undefined}
    class="grid grid-cols-3 gap-2"
  >
    {#each LOBBY_CATEGORIES as category, index (category)}
      {@const checked = draft.category === category}
      <button
        bind:this={tiles[index]}
        type="button"
        role="radio"
        aria-checked={checked}
        tabindex={index === focusIndex ? 0 : -1}
        class="min-h-14 rounded-2xl border px-1.5 py-2 text-sm leading-tight transition {checked
          ? 'border-brand bg-brand/20 font-medium text-paper'
          : 'border-gray-dark bg-gray-dark/40 text-paper'}"
        onclick={() => select(category)}
        onkeydown={(event) => onkeydown(event, index)}
      >
        {LOBBY_CATEGORY_INFO[category].title}
      </button>
    {/each}
  </div>
  {#if issues.category}
    <p id="{id}-category-error" class="text-sm text-brand-light" role="alert">{issues.category}</p>
  {/if}
</section>

<div class="flex flex-col gap-2">
  <div class="flex items-baseline justify-between">
    <label for="{id}-title" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">Название</label
    >
    {#if draft.title.length > TITLE_COUNTER_FROM}
      <span class="text-xs text-gray-light">{draft.title.length} / {LOBBY_TITLE_MAX}</span>
    {/if}
  </div>
  <input
    id="{id}-title"
    type="text"
    bind:value={draft.title}
    maxlength={LOBBY_TITLE_MAX}
    autocomplete="off"
    enterkeyhint="next"
    placeholder={draft.category ? TITLE_PLACEHOLDERS[draft.category] : TITLE_PLACEHOLDER_DEFAULT}
    aria-invalid={issues.title ? true : undefined}
    aria-describedby={issues.title ? `${id}-title-error` : undefined}
    class="{inputClass(!!issues.title)} text-[1.0625rem]"
  />
  {#if issues.title}
    <p id="{id}-title-error" class="text-sm text-brand-light" role="alert">{issues.title}</p>
  {/if}
</div>

<div class="flex flex-col gap-2">
  <div class="flex items-baseline justify-between">
    <label for="{id}-description" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
      Описание, если нужно
    </label>
    {#if draft.description.length > DESCRIPTION_COUNTER_FROM}
      <span class="text-xs text-gray-light">{draft.description.length} / {LOBBY_DESCRIPTION_MAX}</span>
    {/if}
  </div>
  <textarea
    id="{id}-description"
    bind:value={draft.description}
    rows="4"
    maxlength={LOBBY_DESCRIPTION_MAX}
    placeholder={DESCRIPTION_PLACEHOLDER}
    aria-invalid={issues.description ? true : undefined}
    aria-describedby="{id}-privacy{issues.description ? ` ${id}-description-error` : ''}"
    class="{inputClass(!!issues.description)} resize-none text-[0.9375rem]"
  ></textarea>
  {#if issues.description}
    <p id="{id}-description-error" class="text-sm text-brand-light" role="alert">{issues.description}</p>
  {/if}
  <p id="{id}-privacy" class="text-[0.8125rem] leading-snug text-gray-light">{EXACT_ADDRESS_HINT}</p>
</div>
