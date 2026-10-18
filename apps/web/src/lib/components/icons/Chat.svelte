<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Icon>
