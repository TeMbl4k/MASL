<script lang="ts">
  import { ACHIEVEMENT_TEXTS, type Achievement } from '@masl/shared';
  import { haptic } from '#lib/tg/haptics.js';
  import AchievementIcon from './AchievementIcon.svelte';

  interface Props {
    /** Earned achievements of another person, in shelf order. */
    items: readonly Achievement[];
  }

  let { items }: Props = $props();

  let selected = $state<Achievement | null>(null);
</script>

<section class="flex flex-col gap-3" aria-labelledby="person-achievements">
  <h2 id="person-achievements" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
    Ачивки · {items.length}
  </h2>
  <ul class="grid grid-cols-6 gap-1.5">
    {#each items as id (id)}
      <li>
        <button
          type="button"
          class="flex w-full justify-center rounded-full"
          aria-label={ACHIEVEMENT_TEXTS[id].title}
          aria-pressed={selected === id}
          onclick={() => {
            haptic.select();
            selected = selected === id ? null : id;
          }}
        >
          <AchievementIcon {id} size={48} class={selected === id ? 'ring-2 ring-paper' : ''} />
        </button>
      </li>
    {/each}
  </ul>
  <p class="min-h-5 text-[0.8125rem] text-gray-light" aria-live="polite">
    {#if selected}
      <b class="font-semibold text-paper">{ACHIEVEMENT_TEXTS[selected].title}</b> · {ACHIEVEMENT_TEXTS[
        selected
      ].condition}
    {:else}
      Нажмите на значок, чтобы увидеть название и условие
    {/if}
  </p>
</section>
