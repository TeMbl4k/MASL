<script lang="ts">
  import type { Instant, LobbyStatus } from '@masl/shared';
  import { lobbyStatusPill, type StatusPillTone } from '#lib/format/labels.js';
  import { clock } from '#lib/stores/clock.svelte.js';

  interface Props {
    lobby: { status: LobbyStatus; startsAt: Instant; endsAt: Instant; slots: number; approvedCount: number };
    /** On the featured card: dark translucent background over the brand gradient. */
    onBrand?: boolean;
  }

  let { lobby, onBrand = false }: Props = $props();

  const pill = $derived(lobbyStatusPill(lobby, clock.now));

  const TONES: Record<StatusPillTone, string> = {
    open: 'bg-brand/20 text-brand',
    soon: 'bg-brand/20 font-bold text-brand',
    full: 'bg-gray-dark text-gray-light',
    active: 'bg-sand/20 text-sand',
    finished: 'bg-gray-dark text-gray-light',
    cancelled: 'bg-brand-deep/25 text-paper',
  };
</script>

<span
  class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap {onBrand
    ? 'bg-ink/30 font-bold text-paper'
    : TONES[pill.tone]}"
>
  {pill.text}
</span>
