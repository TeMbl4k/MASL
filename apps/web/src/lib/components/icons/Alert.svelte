<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2h.01" /></Icon>
