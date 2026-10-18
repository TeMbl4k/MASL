<script lang="ts">
  import { haptic } from '#lib/tg/haptics.js';

  interface Props {
    value: number;
    min: number;
    max: number;
    /** Accessible name, e.g. «Сколько человек нужно». */
    label: string;
  }

  let { value = $bindable(), min, max, label }: Props = $props();

  function change(delta: number) {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next === value) return;
    haptic.select();
    value = next;
  }

  function onkeydown(event: KeyboardEvent) {
    const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    change(delta);
  }
</script>

<div
  role="spinbutton"
  tabindex="0"
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  class="flex shrink-0 items-center gap-1 rounded-2xl bg-gray-dark/50 p-1"
  {onkeydown}
>
  <button
    type="button"
    tabindex="-1"
    aria-label="Меньше"
    disabled={value <= min}
    class="flex size-11 items-center justify-center rounded-xl bg-gray-dark text-2xl text-paper disabled:text-gray"
    onclick={() => change(-1)}
  >
    −
  </button>
  <span class="w-10 text-center text-[1.375rem] font-bold tabular-nums" aria-hidden="true">{value}</span>
  <button
    type="button"
    tabindex="-1"
    aria-label="Больше"
    disabled={value >= max}
    class="flex size-11 items-center justify-center rounded-xl bg-gray-dark text-2xl text-paper disabled:text-gray"
    onclick={() => change(1)}
  >
    +
  </button>
</div>
