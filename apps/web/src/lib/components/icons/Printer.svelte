<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" /></Icon>
