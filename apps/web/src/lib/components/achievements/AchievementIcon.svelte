<script lang="ts">
  import type { Achievement } from '@masl/shared';
  import { ACHIEVEMENT_ICONS } from '#lib/achievements.js';

  interface Props {
    id: Achievement;
    /** Diameter of the badge in px. */
    size?: number;
    /** Not earned yet: a grey outline. */
    locked?: boolean;
    class?: string;
  }

  let { id, size = 44, locked = false, class: className = '' }: Props = $props();
</script>

<!-- Decorative: the title next to it names the achievement. -->
<span
  class="flex shrink-0 items-center justify-center rounded-full {locked
    ? 'border border-gray-dark bg-ink text-gray'
    : 'bg-linear-135 from-brand-light to-brand-deep text-paper'} {className}"
  style:width="{size}px"
  style:height="{size}px"
  aria-hidden="true"
>
  <svg
    width={Math.round(size / 2)}
    height={Math.round(size / 2)}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"><path d={ACHIEVEMENT_ICONS[id]} /></svg
  >
</span>
