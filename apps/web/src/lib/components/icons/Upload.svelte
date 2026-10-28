<script lang="ts">
  import Icon, { type IconProps } from './Icon.svelte';

  let props: IconProps = $props();
</script>

<Icon {...props}><path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5" /></Icon>
