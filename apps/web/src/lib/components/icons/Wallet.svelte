<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></Icon>
