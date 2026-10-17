<script lang="ts">
  import { updateInterestsInput } from '@masl/shared';
  import { page } from '$app/state';
  import { api } from '#lib/api.js';
  import { session } from '#lib/session.svelte.js';
  import { feed } from '#lib/stores/feed.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { closeSheet } from '#lib/tg/back.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import InterestPicker from './InterestPicker.svelte';
  import Sheet from './Sheet.svelte';

  const current = $derived(session.state.status === 'ready' ? session.state.user.interests : []);

  let selected = $state<string[]>([]);
  let saving = $state(false);

  // Each opening starts from the saved interests.
  $effect(() => {
    if (page.state.sheet === 'interests') selected = [...current];
  });

  const valid = $derived(updateInterestsInput.safeParse({ interests: selected }).success);
  const changed = $derived(
    selected.length !== current.length || selected.some((slug) => !current.includes(slug)),
  );

  async function save() {
    if (!valid || saving) return;
    if (!changed) {
      closeSheet();
      return;
    }
    saving = true;
    try {
      const user = await session.authorized((token) => api.updateInterests(token, selected));
      session.setUser(user);
      // The feed ranks by interests; it reloads only if it was ever shown.
      if (feed.status !== 'idle') void feed.refresh();
      haptic.success();
      closeSheet();
    } catch (error) {
      toast.error(error);
    } finally {
      saving = false;
    }
  }
</script>

<Sheet name="interests" title="Интересы">
  <div class="flex flex-col gap-3">
    <p class="text-sm text-gray-light">По ним лента поднимает подходящие встречи выше.</p>
    <InterestPicker interests={session.interests} bind:selected heading={null} />
  </div>
  {#snippet footer()}
    <button
      type="button"
      disabled={!valid || saving}
      aria-busy={saving}
      class="min-h-12 w-full rounded-2xl bg-brand text-lg font-bold text-paper disabled:opacity-45"
      onclick={save}
    >
      {saving ? 'Сохраняем…' : 'Сохранить'}
    </button>
  {/snippet}
</Sheet>
