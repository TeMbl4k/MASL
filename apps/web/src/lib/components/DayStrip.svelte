<script lang="ts">
  import { FEED_DAY_STRIP_DAYS, type FeedDayDto } from '@masl/shared';
  import { dayChips } from '#lib/format/datetime.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { radioKeyTarget } from './radio-group.js';

  interface Props {
    /** Moscow day 'YYYY-MM-DD'; null: all days. */
    value: string | null;
    onchange?: (value: string | null) => void;
    /** Number of days from today. */
    count?: number;
    /** Lobby counts per day: a dot marks days that have lobbies. */
    days?: FeedDayDto[] | null;
    /** Offer «Все дни» (the feed and the map; the wizard always needs a day). */
    allowAll?: boolean;
    /** Month names above the first chip and where a month starts (the wizard's 31 days). */
    showMonths?: boolean;
    /** Smaller chips over the map. */
    compact?: boolean;
    label?: string;
  }

  let {
    value = $bindable(),
    onchange,
    count = FEED_DAY_STRIP_DAYS,
    days = null,
    allowAll = true,
    showMonths = false,
    compact = false,
    label = 'День',
  }: Props = $props();

  const chips = $derived(dayChips(clock.now, count));
  const counts = $derived(new Map((days ?? []).map((d) => [d.date, d.count])));
  const options = $derived<(string | null)[]>([...(allowAll ? [null] : []), ...chips.map((c) => c.day)]);

  let buttons: HTMLButtonElement[] = $state([]);

  function select(next: string | null) {
    if (next === value) return;
    haptic.select();
    value = next;
    onchange?.(next);
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    const target = radioKeyTarget(event.key, index, options.length);
    if (target === null) return;
    event.preventDefault();
    select(options[target]);
    buttons[target]?.focus();
  }

  const size = $derived(compact ? 'h-12 w-12 rounded-xl' : 'h-14 w-14 rounded-2xl');
  const idle = $derived(compact ? 'border-gray-dark bg-ink/90' : 'border-gray-dark bg-gray-dark/40');
  /** A selected value missing from the strip (it moved past midnight) still focuses the first chip. */
  const focusIndex = $derived(Math.max(0, options.indexOf(value)));
</script>

<div
  role="radiogroup"
  aria-label={label}
  class="-mx-5 flex items-end gap-1.5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
>
  {#if allowAll}
    <button
      bind:this={buttons[0]}
      type="button"
      role="radio"
      aria-checked={value === null}
      tabindex={focusIndex === 0 ? 0 : -1}
      class="{size} shrink-0 border text-xs leading-tight transition {value === null
        ? 'border-brand bg-brand/20 text-paper'
        : `${idle} text-gray-light`}"
      onclick={() => select(null)}
      onkeydown={(event) => onkeydown(event, 0)}
    >
      Все<br />дни
    </button>
  {/if}
  {#each chips as chip, i (chip.day)}
    {@const index = i + (allowAll ? 1 : 0)}
    {@const checked = chip.day === value}
    {@const newMonth = showMonths && (i === 0 || chip.date === 1)}
    <div class="flex shrink-0 flex-col items-start gap-1">
      {#if showMonths}
        <span class="h-4 text-xs text-gray-light">{newMonth ? chip.month : ''}</span>
      {/if}
      <button
        bind:this={buttons[index]}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={chip.ariaLabel}
        tabindex={focusIndex === index ? 0 : -1}
        class="relative flex {size} flex-col items-center justify-center gap-0.5 border transition {checked
          ? 'border-brand bg-brand/20'
          : idle}"
        onclick={() => select(chip.day)}
        onkeydown={(event) => onkeydown(event, index)}
      >
        <span class="text-[0.6875rem] {checked ? 'text-paper' : 'text-gray-light'}">{chip.name}</span>
        <span class="{compact ? 'text-base' : 'text-lg'} leading-none font-semibold">{chip.date}</span>
        {#if (counts.get(chip.day) ?? 0) > 0}
          <span class="absolute bottom-1 size-1 rounded-full bg-brand" aria-hidden="true"></span>
        {/if}
      </button>
    </div>
  {/each}
</div>
