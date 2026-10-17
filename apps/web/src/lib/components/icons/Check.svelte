<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>
