<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}><path d="M4 18 8.5 6l3.5 7 3.5-7L20 18" /><path d="M2.5 18h5M16.5 18h5" /></Icon>
