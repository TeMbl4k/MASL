<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { WizardStep } from '#lib/wizard/validate.js';
  import WizardBack from './WizardBack.svelte';

  interface Props {
    step: WizardStep;
    /** The step's <h1> content («Что <em>затеваем?</em>»). */
    heading: Snippet;
    children: Snippet;
  }

  let { step, heading, children }: Props = $props();

  const STEP_NAMES: Record<WizardStep, string> = { 1: 'Суть', 2: 'Время и место', 3: 'Условия' };
  const STEPS = Object.keys(STEP_NAMES).length;
  const label = $derived(`Шаг ${step} из ${STEPS} · ${STEP_NAMES[step]}`);
</script>

<main class="min-h-app px-5 pt-5 {step === 1 ? 'bg-brand-glow' : ''}">
  <div class="mx-auto flex max-w-lg flex-col gap-6">
    <header class="flex flex-col gap-2.5">
      <WizardBack />
      <span class="text-[0.8125rem] text-gray-light">{label}</span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={STEPS}
        aria-valuenow={step}
        class="grid grid-cols-3 gap-1.5"
      >
        {#each { length: STEPS } as _, index (index)}
          <div class="h-1 rounded-full {index < step ? 'bg-brand' : 'bg-gray-dark'}"></div>
        {/each}
      </div>
      <h1 tabindex="-1" class="mt-1 text-[1.875rem] leading-tight font-light tracking-tight outline-none">
        {@render heading()}
      </h1>
    </header>
    {@render children()}
  </div>
</main>
