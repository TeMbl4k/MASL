<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}
  ><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect
    x="3"
    y="14"
    width="7"
    height="7"
    rx="1"
  /><path d="M14 14h3v3h-3zM20 14v1M14 20h7M20 17v4" /></Icon
>
