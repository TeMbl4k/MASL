<script lang="ts">
  import { LOBBY_START_STEP_MINUTES } from '@masl/shared';
  import { deviceOutsideMoscowTime } from '#lib/format/datetime.js';
  import { haptic } from '#lib/tg/haptics.js';
  import ChevronDown from '../icons/ChevronDown.svelte';

  interface Props {
    hour: number;
    minute: number;
    invalid?: boolean;
    /** Id of the error text under the control. */
    describedBy?: string;
  }

  let { hour = $bindable(), minute = $bindable(), invalid = false, describedBy }: Props = $props();

  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Array.from({ length: 24 }, (_, i) => i);
  /** The 5-minute grid, plus a restored value that is off it. */
  const minutes = $derived.by(() => {
    const grid = Array.from(
      { length: 60 / LOBBY_START_STEP_MINUTES },
      (_, i) => i * LOBBY_START_STEP_MINUTES,
    );
    return grid.includes(minute) ? grid : [...grid, minute].sort((a, b) => a - b);
  });
  const outsideMoscow = deviceOutsideMoscowTime();
  const labelId = $props.id();

  const selectClass = $derived(
    `min-h-11 appearance-none rounded-xl border bg-gray-dark/40 pr-9 pl-3.5 text-[1.0625rem] text-paper [color-scheme:dark] ${
      invalid ? 'border-brand-light' : 'border-gray-dark'
    }`,
  );
</script>

<!-- The selects are restyled (appearance-none), so the chevron marks them as dropdowns. -->
{#snippet chevron()}
  <ChevronDown
    size={16}
    class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-light"
  />
{/snippet}

<div role="group" aria-labelledby={labelId} class="flex flex-wrap items-center gap-2.5">
  <span id={labelId} class="w-16 text-[0.9375rem]">Начало</span>
  <span class="relative flex">
    <select
      aria-label="Часы"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      bind:value={hour}
      onchange={() => haptic.select()}
      class={selectClass}
    >
      {#each hours as value (value)}
        <option {value}>{pad(value)}</option>
      {/each}
    </select>
    {@render chevron()}
  </span>
  <span class="text-[1.0625rem]" aria-hidden="true">:</span>
  <span class="relative flex">
    <select
      aria-label="Минуты"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      bind:value={minute}
      onchange={() => haptic.select()}
      class={selectClass}
    >
      {#each minutes as value (value)}
        <option {value}>{pad(value)}</option>
      {/each}
    </select>
    {@render chevron()}
  </span>
  {#if outsideMoscow}
    <span class="text-[0.8125rem] text-gray-light">время московское</span>
  {/if}
</div>
