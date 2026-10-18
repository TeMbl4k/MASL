<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}
  ><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path
    d="M12 2v3M12 19v3M2 12h3M19 12h3"
  /></Icon
>
