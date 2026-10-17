<script lang="ts" generics="T extends string | number">
  import { haptic } from '#lib/tg/haptics.js';
  import { radioKeyTarget } from '../radio-group.js';

  interface Props {
    options: readonly { value: T; label: string }[];
    value: T;
    /** Accessible name of the group. */
    label: string;
    onchange?: (value: T) => void;
    /** Greyed out; the value is kept but not highlighted, so it doesn't read as applied. */
    disabled?: boolean;
    /** `track`: options on a shared dark track (payment, tabs); `grid`: separate outlined cells. */
    look?: 'track' | 'grid';
  }

  let { options, value = $bindable(), label, onchange, disabled = false, look = 'track' }: Props = $props();

  let buttons: HTMLButtonElement[] = $state([]);
  const focusIndex = $derived(
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );

  function select(next: T) {
    if (disabled || next === value) return;
    haptic.select();
    value = next;
    onchange?.(next);
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    const target = radioKeyTarget(event.key, index, options.length);
    if (target === null) return;
    event.preventDefault();
    select(options[target].value);
    buttons[target]?.focus();
  }
</script>

<div
  role="radiogroup"
  aria-label={label}
  aria-disabled={disabled || undefined}
  class="grid gap-1.5 {look === 'track' ? 'rounded-2xl bg-gray-dark/50 p-1' : ''} {disabled
    ? 'opacity-45'
    : ''}"
  style:grid-template-columns="repeat({options.length}, minmax(0, 1fr))"
>
  {#each options as option, index (option.value)}
    {@const checked = option.value === value}
    {@const marked = checked && !disabled}
    <button
      bind:this={buttons[index]}
      type="button"
      role="radio"
      aria-checked={checked}
      tabindex={index === focusIndex ? 0 : -1}
      {disabled}
      class="min-h-11 rounded-xl border px-1 text-[0.9375rem] transition {marked
        ? 'border-brand bg-brand/20 font-semibold text-paper'
        : look === 'track'
          ? 'border-transparent text-gray-light'
          : 'border-gray-dark text-paper'}"
      onclick={() => select(option.value)}
      onkeydown={(event) => onkeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>
