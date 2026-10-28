<script lang="ts">
  import { ACHIEVEMENT_TEXTS, type AchievementDto } from '@masl/shared';
  import ProgressBar from './ProgressBar.svelte';

  interface Props {
    item: AchievementDto;
    /** «Следующая» on the profile, «Дальше» after a new one. */
    label: string;
    href?: string;
  }

  let { item, label, href }: Props = $props();
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  {href}
  class="flex flex-col gap-2 rounded-2xl border border-gray-dark bg-gray-dark/40 p-3.5"
>
  <span class="flex items-baseline justify-between gap-3 text-sm">
    <span>{label}: <b class="font-semibold">{ACHIEVEMENT_TEXTS[item.id].title}</b></span>
    <span class="shrink-0 text-gray-light">{item.current} из {item.goal}</span>
  </span>
  <ProgressBar current={item.current} goal={item.goal} thick />
</svelte:element>
