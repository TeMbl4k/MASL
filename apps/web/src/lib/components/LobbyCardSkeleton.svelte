<script lang="ts">
  interface Props {
    variant?: 'default' | 'compact';
  }

  let { variant = 'default' }: Props = $props();
</script>

<!-- Placeholder while cards load; the pulse stops under reduced motion (layout.css). -->
<div
  aria-hidden="true"
  class="animate-pulse border border-gray-dark bg-gray-dark/40 {variant === 'compact'
    ? 'flex items-center gap-3 rounded-2xl p-3'
    : 'flex flex-col gap-3 rounded-3xl p-[1.125rem]'}"
>
  {#if variant === 'compact'}
    <div class="size-11 rounded-xl bg-gray-dark"></div>
    <div class="flex flex-1 flex-col gap-2">
      <div class="h-4 w-3/4 rounded bg-gray-dark"></div>
      <div class="h-3 w-1/2 rounded bg-gray-dark"></div>
    </div>
  {:else}
    <div class="h-6 w-20 rounded-full bg-gray-dark"></div>
    <div class="h-6 w-4/5 rounded bg-gray-dark"></div>
    <div class="h-4 w-3/5 rounded bg-gray-dark"></div>
    <div class="flex items-center gap-2">
      <div class="size-7 rounded-full bg-gray-dark"></div>
      <div class="h-4 w-1/3 rounded bg-gray-dark"></div>
    </div>
  {/if}
</div>
