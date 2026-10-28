<script lang="ts">
  import { TERMS_VERSION, type MeDto } from '@masl/shared';
  import { describeError } from '#lib/errors.js';
  import TermsText from './TermsText.svelte';

  interface Props {
    user: MeDto;
    onAccept: () => Promise<void>;
  }

  let { user, onAccept }: Props = $props();

  let checked = $state(false);
  let submitting = $state(false);
  /** Continue was tapped without the box ticked: show why until it is ticked. */
  let triedUnchecked = $state(false);
  let error = $state<string | null>(null);

  async function submit() {
    if (!checked) {
      triedUnchecked = true;
      return;
    }
    submitting = true;
    error = null;
    try {
      await onAccept();
    } catch (failure) {
      const described = describeError(failure);
      error =
        described.kind === 'message' ? described.text : 'Откройте приложение заново, чтобы обновить его.';
    } finally {
      submitting = false;
    }
  }
</script>

<section class="bg-brand-glow flex min-h-app flex-col gap-6 px-5 pt-14 pb-28">
  <header class="space-y-2">
    <p class="text-xs tracking-[0.12em] text-gray-light uppercase">
      Пользовательское соглашение · версия {TERMS_VERSION}, тестовая
    </p>
    {#if user.onboarded}
      <h1 class="text-4xl font-light tracking-tight">
        Мы обновили <span class="font-semibold italic">соглашение</span>
      </h1>
      <p class="text-gray-light">Чтобы продолжить пользоваться MASL, прочитайте и примите новую версию.</p>
    {:else}
      <h1 class="text-4xl font-light tracking-tight">
        Прежде чем <span class="font-semibold italic">начать</span>
      </h1>
      <p class="text-gray-light">
        MASL помогает найти компанию на встречу в Москве. Прочитайте правила и примите их внизу.
      </p>
    {/if}
  </header>

  <div class="rounded-3xl border border-gray-dark bg-ink/70 px-4 py-5">
    <TermsText />
  </div>

  <label
    class="flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition {checked
      ? 'border-brand bg-brand/15'
      : 'border-gray-dark bg-gray-dark/40'}"
  >
    <input
      type="checkbox"
      bind:checked
      class="mt-0.5 size-5 shrink-0 accent-brand"
      onchange={() => (triedUnchecked = false)}
    />
    <span>Мне есть 18 лет, я прочитал(а) и принимаю пользовательское соглашение</span>
  </label>

  {#if triedUnchecked && !checked}
    <p class="text-brand-light" role="alert">Отметьте, что вам есть 18 лет и вы принимаете соглашение</p>
  {:else if error}
    <p class="text-brand-light" role="alert">{error}</p>
  {/if}

  <div class="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/90 to-transparent px-5 pt-6 pb-8">
    <!-- The button stays enabled while unticked so a tap can explain what's missing. -->
    <button
      type="button"
      class="w-full rounded-2xl py-4 text-xl font-bold transition {checked
        ? 'bg-brand text-paper'
        : 'bg-gray-dark text-gray-light'}"
      disabled={submitting}
      onclick={submit}
    >
      {submitting ? 'Сохраняем…' : 'Принимаю'}
    </button>
  </div>
</section>
