<script lang="ts">
  import { progressWidth } from '#lib/achievements.js';

  interface Props {
    current: number;
    goal: number;
    /** Thicker on cards, thinner in lists. */
    thick?: boolean;
  }

  let { current, goal, thick = false }: Props = $props();
</script>

<!-- The «N из M» text next to it carries the value. -->
<span class="block rounded-full bg-gray-dark {thick ? 'h-1.5' : 'h-1'}" aria-hidden="true">
  <span class="block h-full rounded-full bg-brand" style:width={progressWidth(current, goal)}></span>
</span>
