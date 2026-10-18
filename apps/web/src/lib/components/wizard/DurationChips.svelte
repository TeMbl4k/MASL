<script lang="ts">
  import { formatMoscowTime, LOBBY_DURATION_PRESETS_MINUTES } from '@masl/shared';
  import { formatDuration } from '#lib/format/datetime.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { radioKeyTarget } from '../radio-group.js';

  interface Props {
    value: number;
    /** ISO end of the lobby for «до 21:30»; null while the start is invalid. */
    endsAt: string | null;
  }

  let { value = $bindable(), endsAt }: Props = $props();

  const labelId = $props.id();
  let buttons: HTMLButtonElement[] = $state([]);
  const options = LOBBY_DURATION_PRESETS_MINUTES;
  const focusIndex = $derived(Math.max(0, options.indexOf(value as (typeof options)[number])));

  function select(next: number) {
    if (next === value) return;
    haptic.select();
    value = next;
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    const target = radioKeyTarget(event.key, index, options.length);
    if (target === null) return;
    event.preventDefault();
    select(options[target]);
    buttons[target]?.focus();
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-baseline justify-between gap-3">
    <span id={labelId} class="text-[0.9375rem]">Длится</span>
    {#if endsAt}
      <span class="text-[0.8125rem] text-gray-light">до {formatMoscowTime(endsAt)}</span>
    {/if}
  </div>
  <div
    role="radiogroup"
    aria-labelledby={labelId}
    class="-mx-5 flex gap-1.5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    {#each options as minutes, index (minutes)}
      {@const checked = minutes === value}
      <button
        bind:this={buttons[index]}
        type="button"
        role="radio"
        aria-checked={checked}
        tabindex={index === focusIndex ? 0 : -1}
        class="min-h-11 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap transition {checked
          ? 'border-brand bg-brand/20 font-semibold text-paper'
          : 'border-gray-dark bg-gray-dark/40 text-paper'}"
        onclick={() => select(minutes)}
        onkeydown={(event) => onkeydown(event, index)}
      >
        {formatDuration(minutes)}
      </button>
    {/each}
  </div>
</div>
