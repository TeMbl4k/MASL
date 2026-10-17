<script lang="ts">
  import TabBar from '#lib/components/TabBar.svelte';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<!-- Tab roots keep their content clear of the fixed tab bar and the bottom safe area. -->
<div class="min-h-dvh pb-[calc(var(--tab-bar-height)+var(--safe-bottom)+1rem)]">
  {@render children()}
</div>
<TabBar />
