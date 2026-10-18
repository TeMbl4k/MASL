<script lang="ts">
  import { LOBBY_CATEGORY_INFO, type CreationContextDto } from '@masl/shared';
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '#lib/api.js';
  import BottomAction from '#lib/components/BottomAction.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import CreationGate from '#lib/components/wizard/CreationGate.svelte';
  import StepEssence from '#lib/components/wizard/StepEssence.svelte';
  import StepTerms from '#lib/components/wizard/StepTerms.svelte';
  import StepWhenWhere from '#lib/components/wizard/StepWhenWhere.svelte';
  import WizardBack from '#lib/components/wizard/WizardBack.svelte';
  import WizardFrame from '#lib/components/wizard/WizardFrame.svelte';
  import { describeError } from '#lib/errors.js';
  import { session } from '#lib/session.svelte.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { back } from '#lib/tg/back.svelte.js';
  import { useClosingConfirmation } from '#lib/tg/closing.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { dismissKeyboard } from '#lib/tg/keyboard.js';
  import { confirm } from '#lib/tg/popup.js';
  import { usePrimaryAction } from '#lib/tg/primary-action.svelte.js';
  import type { PersistedDraft } from '#lib/wizard/draft-codec.js';
  import { clearSavedDraft, LobbyDraft, loadSavedDraft, useDraftAutosave } from '#lib/wizard/draft.svelte.js';
  import { firstInvalidStep, hasIssues, toCreateInput, type WizardStep } from '#lib/wizard/validate.js';

  type Phase = 'loading' | 'error' | 'gate' | 'restore' | 'steps';

  let phase = $state<Phase>('loading');
  let context = $state<CreationContextDto | null>(null);
  let loadError = $state<string | null>(null);
  let saved = $state<PersistedDraft | null>(null);
  let publishing = $state(false);
  let published = $state(false);
  /** Leaving from step 1 was confirmed: Back goes on to the previous page. */
  let leaving = $state(false);

  const draft = new LobbyDraft(Date.now());
  const autosave = useDraftAutosave(draft, () => phase === 'steps' && !published);
  useClosingConfirmation(() => phase === 'steps' && draft.dirty && !published);

  const stepIssues = $derived(draft.issues(draft.step, clock.now));
  const shownIssues = $derived(draft.tried[draft.step] ? stepIssues : {});

  async function loadContext(): Promise<CreationContextDto | null> {
    try {
      const next = await session.authorized((token) => api.creationContext(token));
      context = next;
      return next;
    } catch (error) {
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
      return null;
    }
  }

  async function start() {
    phase = 'loading';
    loadError = null;
    const next = await loadContext();
    if (!next) {
      phase = 'error';
      return;
    }
    if (!next.canCreate) {
      phase = 'gate';
      return;
    }
    saved = loadSavedDraft();
    phase = saved ? 'restore' : 'steps';
  }

  onMount(() => {
    void start();
  });

  function continueDraft() {
    if (saved) draft.restore(saved, Date.now());
    saved = null;
    phase = 'steps';
  }

  function startOver() {
    clearSavedDraft();
    draft.reset(Date.now());
    saved = null;
    phase = 'steps';
  }

  async function goToStep(step: WizardStep) {
    dismissKeyboard();
    draft.step = step;
    await tick();
    window.scrollTo({ top: 0 });
  }

  /** Scrolls to the first field with an error after a refused «Далее». */
  async function revealErrors() {
    await tick();
    document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function next() {
    const step = draft.step;
    if (hasIssues(draft.issues(step, Date.now()))) {
      draft.tried[step] = true;
      haptic.error();
      void revealErrors();
      return;
    }
    if (step < 3) void goToStep((step + 1) as WizardStep);
    else void publish();
  }

  async function publish() {
    if (publishing) return;
    publishing = true;
    const metro = await draft.loadMetro();
    // The clock moved since the earlier steps: the start or the pin may no longer pass.
    const invalid = firstInvalidStep(draft.values, Date.now(), metro?.nearestStation);
    const input = invalid ? null : toCreateInput(draft.values);
    if (!input) {
      publishing = false;
      const step = invalid ?? 1;
      draft.tried[step] = true;
      haptic.error();
      await goToStep(step);
      void revealErrors();
      return;
    }
    try {
      const detail = await session.authorized((token) => api.createLobby(token, input));
      haptic.success();
      autosave.cancel();
      clearSavedDraft();
      published = true;
      // Primes the cache and makes «Мои» refetch.
      lobbyCache.setDetail(detail);
      await goto(`/my?tab=hosting&new=${detail.id}`, { replace: true });
      toast.show('Встреча опубликована', 'success');
    } catch (error) {
      publishing = false;
      toast.error(error);
      if (!(error instanceof ApiError)) return;
      if (error.status === 403 || error.status === 429) {
        // A limit or a block: the gate explains it (a plain rate limit keeps the steps).
        const next = await loadContext();
        if (next && !next.canCreate) phase = 'gate';
      } else if (error.status === 400) {
        // The error body's issues are not readable here: re-check locally and open that step.
        const step = firstInvalidStep(draft.values, Date.now(), metro?.nearestStation);
        if (step) {
          draft.tried[step] = true;
          await goToStep(step);
        }
      }
    }
  }

  async function onBack() {
    if (draft.step > 1) {
      void goToStep((draft.step - 1) as WizardStep);
      return;
    }
    const ok = await confirm({
      title: 'Выйти из создания?',
      message: 'Черновик сохранится, его можно будет продолжить.',
      confirmText: 'Выйти',
    });
    if (!ok) return;
    leaving = true;
    await tick();
    back.go();
  }

  // Back walks the steps; on step 1 it asks before leaving a draft.
  $effect(() => {
    if (phase !== 'steps' || published) return;
    if (draft.step === 1 && (!draft.dirty || leaving)) return;
    return back.addHandler(() => void onBack());
  });

  const primary = usePrimaryAction(() => ({
    text: draft.step === 3 ? 'Опубликовать' : 'Далее',
    visible: phase === 'steps' && !published,
    state: publishing ? 'loading' : hasIssues(stepIssues) ? 'incomplete' : 'ready',
    onClick: next,
  }));

  const savedLabel = $derived(
    saved ? saved.title.trim() || (saved.category ? LOBBY_CATEGORY_INFO[saved.category].title : null) : null,
  );
</script>

<svelte:head>
  <title>Новая встреча — MASL</title>
</svelte:head>

{#if phase === 'loading'}
  <main class="bg-brand-glow flex min-h-dvh flex-col px-5 pt-5" aria-busy="true">
    <WizardBack />
    <div class="flex flex-1 items-center justify-center pb-16">
      <p class="text-gray-light">Загружаем…</p>
    </div>
  </main>
{:else if phase === 'error'}
  <main class="flex min-h-dvh flex-col px-5 pt-5">
    <WizardBack />
    <div class="flex flex-1 flex-col justify-center pb-16">
      <ErrorState
        title="Не удалось открыть создание встречи"
        message={loadError}
        onretry={() => void start()}
      />
    </div>
  </main>
{:else if phase === 'gate' && context}
  <CreationGate {context} />
{:else if phase === 'restore'}
  <main class="bg-brand-glow flex min-h-dvh flex-col px-5 pt-5 pb-16">
    <WizardBack />
    <section
      class="mx-auto my-auto flex w-full max-w-lg flex-col gap-4 rounded-3xl border border-gray-dark bg-ink/60 p-6"
      aria-labelledby="restore-title"
    >
      <h1 id="restore-title" tabindex="-1" class="text-[1.75rem] leading-tight font-light outline-none">
        Продолжить <span class="font-semibold italic">черновик?</span>
      </h1>
      {#if savedLabel}
        <p class="text-gray-light">«{savedLabel}»</p>
      {/if}
      <div class="flex flex-col gap-2.5">
        <button
          type="button"
          class="min-h-12 rounded-2xl bg-brand text-lg font-bold text-paper"
          onclick={continueDraft}
        >
          Продолжить
        </button>
        <button
          type="button"
          class="min-h-12 rounded-2xl border border-gray-dark text-[0.9375rem] text-paper"
          onclick={startOver}
        >
          Начать заново
        </button>
      </div>
    </section>
  </main>
{:else if phase === 'steps'}
  {#if draft.step === 1}
    <WizardFrame step={1}>
      {#snippet heading()}Что <span class="font-semibold italic">затеваем?</span>{/snippet}
      <StepEssence {draft} issues={shownIssues} />
    </WizardFrame>
  {:else if draft.step === 2}
    <WizardFrame step={2}>
      {#snippet heading()}Когда <span class="font-semibold italic">и где</span>{/snippet}
      <StepWhenWhere {draft} issues={shownIssues} addressSuggest={context?.addressSuggest ?? false} />
    </WizardFrame>
  {:else}
    <WizardFrame step={3}>
      {#snippet heading()}Последние <span class="font-semibold italic">условия</span>{/snippet}
      <StepTerms {draft} issues={shownIssues} />
    </WizardFrame>
  {/if}
  {#if primary.fallback}
    <BottomAction {...primary.fallback} />
  {:else}
    <!-- Room above Telegram's MainButton. -->
    <div class="h-6" aria-hidden="true"></div>
  {/if}
{/if}
