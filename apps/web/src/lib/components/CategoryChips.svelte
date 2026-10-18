<script lang="ts">
  import { INTERESTS, LOBBY_CATEGORY_INFO, type LobbyCategory } from '@masl/shared';
  import { session } from '#lib/session.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { radioKeyTarget } from './radio-group.js';

  interface Props {
    /** null: no filter («Для вас»). */
    value: LobbyCategory | null;
    onchange?: (value: LobbyCategory | null) => void;
    /** Floating over the map: denser chips on a solid background. */
    floating?: boolean;
  }

  let { value = $bindable(), onchange, floating = false }: Props = $props();

  /** «Для вас», the viewer's interests, the other interests, then «✨ Другое». */
  const options = $derived.by(() => {
    const mine = session.state.status === 'ready' ? session.state.user.interests : [];
    const slugs = INTERESTS.map((i) => i.slug);
    const ordered = [...slugs.filter((s) => mine.includes(s)), ...slugs.filter((s) => !mine.includes(s))];
    return [
      { value: null, label: 'Для вас' },
      ...ordered.map((slug) => ({ value: slug as LobbyCategory, label: LOBBY_CATEGORY_INFO[slug].title })),
      {
        value: 'other' as const,
        label: `${LOBBY_CATEGORY_INFO.other.emoji} ${LOBBY_CATEGORY_INFO.other.title}`,
      },
    ];
  });

  let buttons: HTMLButtonElement[] = $state([]);

  function select(next: LobbyCategory | null) {
    if (next === value) return;
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
  aria-label="Категория"
  class="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
>
  {#each options as option, index (option.value ?? 'all')}
    {@const checked = option.value === value}
    <button
      bind:this={buttons[index]}
      type="button"
      role="radio"
      aria-checked={checked}
      tabindex={checked ? 0 : -1}
      class="min-h-11 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap transition {checked
        ? 'border-brand bg-brand/20 font-medium text-paper'
        : floating
          ? 'border-gray-dark bg-ink/90 text-paper'
          : 'border-gray-dark bg-gray-dark/40 text-paper'}"
      onclick={() => select(option.value)}
      onkeydown={(event) => onkeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>
