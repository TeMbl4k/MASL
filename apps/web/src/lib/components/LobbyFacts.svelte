<script lang="ts">
  import type { LobbyCardDto } from '@masl/shared';
  import { formatLobbyWhen } from '#lib/format/datetime.js';
  import { formatDistance } from '#lib/format/distance.js';
  import { formatMinKarma, formatSeats, PAYMENT_FORMAT_LABELS } from '#lib/format/labels.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import Clock from './icons/Clock.svelte';
  import Pin from './icons/Pin.svelte';
  import Star from './icons/Star.svelte';
  import Users from './icons/Users.svelte';
  import Wallet from './icons/Wallet.svelte';
  import InfoRow from './InfoRow.svelte';

  interface Props {
    lobby: LobbyCardDto;
  }

  let { lobby }: Props = $props();

  const minKarma = $derived(formatMinKarma(lobby.minKarma));
</script>

<!-- The public facts of a lobby: time, approximate place, seats, payment and the karma threshold. -->
<div class="flex flex-col gap-3">
  <InfoRow icon={Clock}>
    <time datetime={lobby.startsAt}>{formatLobbyWhen(lobby.startsAt, lobby.endsAt, clock.now)}</time>
  </InfoRow>
  <InfoRow icon={Pin}>
    <span class="inline-flex flex-wrap items-center gap-x-1.5">
      <span class="inline-flex items-center gap-1.5">
        {#if lobby.place.lineColor}
          <span
            class="size-2.5 shrink-0 rounded-full"
            style:background-color={lobby.place.lineColor}
            aria-hidden="true"
          ></span>
        {/if}
        {lobby.place.hint}
      </span>
      {#if lobby.distanceM !== null}
        <span aria-hidden="true">·</span>
        <span>{formatDistance(lobby.distanceM)} от вас</span>
      {/if}
      {#if lobby.place.farFromMetro}
        <span aria-hidden="true">·</span>
        <span>далеко от метро</span>
      {/if}
    </span>
  </InfoRow>
  <InfoRow icon={Users}>{formatSeats(lobby.slots, lobby.approvedCount)}</InfoRow>
  <InfoRow icon={Wallet}>{PAYMENT_FORMAT_LABELS[lobby.paymentFormat]}</InfoRow>
  {#if minKarma}
    <InfoRow icon={Star}>{minKarma}</InfoRow>
  {/if}
</div>
