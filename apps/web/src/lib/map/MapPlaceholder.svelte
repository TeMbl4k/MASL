<script lang="ts">
  interface Props {
    text?: string;
  }

  let { text = 'Загружаем карту…' }: Props = $props();
</script>

<!-- Fills the map area while MapLibre and the style load. -->
<div class="absolute inset-0 flex items-center justify-center bg-ink" aria-busy="true">
  <p class="text-gray-light">{text}</p>
</div>
