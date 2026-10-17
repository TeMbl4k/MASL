<script lang="ts">
  import type { ApplyBlockReason, MembershipStatus } from '@masl/shared';
  import { membershipLabel } from '#lib/format/labels.js';

  interface Props {
    status: MembershipStatus | null;
    applyBlock?: ApplyBlockReason | null;
    onBrand?: boolean;
  }

  let { status, applyBlock = null, onBrand = false }: Props = $props();

  const label = $derived(membershipLabel(status, applyBlock));
</script>

{#if label}
  <span
    class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap {onBrand
      ? 'border-paper/60 text-paper'
      : label.tone === 'member'
        ? 'border-brand bg-brand/20 text-paper'
        : label.tone === 'pending'
          ? 'border-sand/60 text-sand'
          : 'border-gray-dark text-gray-light'}"
  >
    {label.text}
  </span>
{/if}
