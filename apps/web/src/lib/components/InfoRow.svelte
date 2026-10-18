<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import type { IconProps } from './icons/Icon.svelte';

  interface Props {
    icon: Component<IconProps>;
    children: Snippet;
  }

  let { icon: Icon, children }: Props = $props();
</script>

<div class="flex items-start gap-3 text-[0.9375rem]">
  <Icon size={20} class="mt-0.5 text-brand" />
  <div class="min-w-0 flex-1">{@render children()}</div>
</div>
