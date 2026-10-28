<script lang="ts">
  import type { QrCode } from '@masl/shared/qr';

  interface Props {
    /** The link the code opens. */
    text: string;
    /** Side in px, quiet zone included. */
    size: number;
    label: string;
  }

  let { text, size, label }: Props = $props();

  let code = $state<QrCode | null>(null);
  let margin = $state(4);

  // The encoder is loaded apart from the main bundle: only these screens need it.
  $effect(() => {
    const value = text;
    let current = true;
    import('@masl/shared/qr').then(
      (qr) => {
        if (!current) return;
        code = qr.qrCode(value);
        margin = qr.QR_MARGIN;
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  });

  const side = $derived(code ? code.size + 2 * margin : 0);
</script>

{#if code}
  <svg
    width={size}
    height={size}
    viewBox="-{margin} -{margin} {side} {side}"
    shape-rendering="crispEdges"
    role="img"
    aria-label={label}
    class="rounded-xl bg-white"
  >
    <rect x={-margin} y={-margin} width={side} height={side} fill="#ffffff" />
    <path d={code.path} fill="#000000" />
  </svg>
{:else}
  <div
    class="animate-pulse rounded-xl bg-gray-light/40"
    style:width="{size}px"
    style:height="{size}px"
    aria-busy="true"
  ></div>
{/if}
