<script lang="ts">
  import {
    AGE_MAX,
    AGE_MIN,
    INTERESTS_MAX,
    INTERESTS_MIN,
    onboardingInput,
    type Gender,
    type InterestDto,
    type MeDto,
    type OnboardingInput,
  } from '@masl/shared';
  import InterestPicker from './InterestPicker.svelte';

  interface Props {
    user: MeDto;
    interests: InterestDto[];
    onSubmit: (input: OnboardingInput) => Promise<void>;
  }

  let { user, interests, onSubmit }: Props = $props();

  let gender = $state<Gender | null>(null);
  let age = $state(25);
  let selected = $state<string[]>([]);
  let submitting = $state(false);
  /** Submit was tapped with an incomplete form: show what's missing until it's filled in. */
  let triedIncomplete = $state(false);
  let error = $state<string | null>(null);

  const ages = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i);
  const isComplete = $derived(
    gender !== null && selected.length >= INTERESTS_MIN && selected.length <= INTERESTS_MAX,
  );

  async function submit() {
    const parsed = onboardingInput.safeParse({ gender, age, interests: selected });
    if (!parsed.success) {
      triedIncomplete = true;
      return;
    }
    submitting = true;
    error = null;
    try {
      await onSubmit(parsed.data);
    } catch {
      error = 'Не получилось сохранить. Попробуйте ещё раз.';
    } finally {
      submitting = false;
    }
  }
</script>

<section class="bg-brand-glow flex min-h-app flex-col gap-8 px-5 pt-14 pb-28">
  <header class="space-y-2">
    <h1 class="text-4xl font-light tracking-tight">
      Привет, <span class="font-semibold italic">{user.firstName}</span>!
    </h1>
    <p class="text-gray-light">Пара вопросов, чтобы показать встречи, которые вам подходят.</p>
  </header>

  <div class="space-y-3">
    <h2 class="text-sm tracking-widest text-gray-light uppercase">Пол</h2>
    <div class="grid grid-cols-2 gap-3">
      {#each [{ value: 'male', label: 'Мужской' }, { value: 'female', label: 'Женский' }] as option (option.value)}
        <button
          type="button"
          class="rounded-2xl border px-4 py-3 text-left transition {gender === option.value
            ? 'border-brand bg-brand/15'
            : 'border-gray-dark bg-gray-dark/40'}"
          aria-pressed={gender === option.value}
          onclick={() => (gender = option.value as Gender)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="space-y-3">
    <label for="age" class="text-sm tracking-widest text-gray-light uppercase">Возраст</label>
    <select
      id="age"
      bind:value={age}
      class="w-full appearance-none rounded-2xl border border-gray-dark bg-gray-dark/40 px-4 py-3 text-lg"
    >
      {#each ages as value (value)}
        <option {value}>{value}</option>
      {/each}
    </select>
  </div>

  <InterestPicker {interests} bind:selected />

  {#if triedIncomplete && !isComplete}
    <p class="text-brand-light" role="alert">
      Выберите пол и от {INTERESTS_MIN} до {INTERESTS_MAX} интересов
    </p>
  {:else if error}
    <p class="text-brand-light" role="alert">{error}</p>
  {/if}

  <div class="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/90 to-transparent px-5 pt-6 pb-8">
    <!-- The button stays enabled on an incomplete form so a tap can explain what's missing. -->
    <button
      type="button"
      class="w-full rounded-2xl py-4 text-xl font-bold transition {isComplete
        ? 'bg-brand text-paper'
        : 'bg-gray-dark text-gray-light'}"
      disabled={submitting}
      onclick={submit}
    >
      {submitting ? 'Сохраняем…' : 'Начать поиск'}
    </button>
  </div>
</section>
