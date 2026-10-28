<script lang="ts">
  import NewAchievementSheet from '#lib/components/achievements/NewAchievementSheet.svelte';
  import TabBar from '#lib/components/TabBar.svelte';
  import { useRefreshWhenActive } from '#lib/stores/clock.svelte.js';
  import { myLobbies } from '#lib/stores/my-lobbies.svelte.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  // The «Мои» dot needs the hosted lobbies; refreshed when stale and the app comes back.
  useRefreshWhenActive(() => void myLobbies.ensure());
</script>

<!-- Tab roots keep their content clear of the fixed tab bar and the bottom safe area. -->
<div class="min-h-app pb-[calc(var(--tab-bar-height)+var(--safe-bottom)+1rem)]">
  {@render children()}
</div>
<TabBar />
<NewAchievementSheet />
