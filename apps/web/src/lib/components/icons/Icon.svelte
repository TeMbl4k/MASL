<script lang="ts" module>
  export interface IconProps {
    /** Width and height in px. */
    size?: number;
    class?: string;
    strokeWidth?: number;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    size = 22,
    class: className = '',
    strokeWidth = 2,
    fill = 'none',
    children,
  }: IconProps & { fill?: string; children: Snippet } = $props();
</script>

<!-- Decorative: the control that holds an icon carries the accessible name. -->
<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  {fill}
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  class="shrink-0 {className}"
>
  {@render children()}
</svg>
