<script lang="ts" module>
  /** «+10», «−15» (a real minus sign), «0». */
  export function formatKarmaDelta(delta: number): string {
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return `−${Math.abs(delta)}`;
    return '0';
  }
</script>

<script lang="ts">
  import { KARMA, LATE_CANCEL_WINDOW_HOURS } from '@masl/shared';
  import { pluralForm } from '#lib/format/plural.js';

  interface Props {
    karma: number;
  }

  let { karma }: Props = $props();

  const HOUR_FORMS = ['час', 'часа', 'часов'] as const;

  const rules = [
    { delta: KARMA.ATTENDED, text: 'пришли на встречу' },
    {
      delta: KARMA.LATE_CANCEL,
      text: `отменили позже чем за ${LATE_CANCEL_WINDOW_HOURS} ${pluralForm(LATE_CANCEL_WINDOW_HOURS, HOUR_FORMS)}`,
    },
    { delta: KARMA.NO_SHOW, text: 'не пришли и не предупредили' },
  ];
</script>

<section
  class="bg-brand-glow flex flex-col gap-3.5 rounded-3xl border border-gray-dark p-5"
  aria-labelledby="karma-card-title"
>
  <h2 id="karma-card-title" class="flex items-baseline gap-2.5">
    <span class="text-[3.5rem] leading-none font-bold">{karma}</span>
    <span class="text-lg">карма</span>
  </h2>
  <p class="text-sm text-sand">
    Старт — {KARMA.START}. Карма решает, на какие встречи можно подать заявку.
  </p>
  <ul class="flex flex-col gap-2 text-sm">
    {#each rules as rule (rule.delta)}
      <li class="flex gap-3">
        <span class="w-9 shrink-0 font-bold {rule.delta > 0 ? 'text-paper' : 'text-brand-light'}">
          {formatKarmaDelta(rule.delta)}
        </span>
        <span>{rule.text}</span>
      </li>
    {/each}
  </ul>
</section>
