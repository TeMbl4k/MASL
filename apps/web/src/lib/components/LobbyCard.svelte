<script lang="ts">
  import { formatMoscowTime, LOBBY_CATEGORY_INFO, type LobbyCardDto } from '@masl/shared';
  import type { Snippet } from 'svelte';
  import { formatLobbyStart } from '#lib/format/datetime.js';
  import { formatDistance } from '#lib/format/distance.js';
  import { formatSeats } from '#lib/format/labels.js';
  import { minKarmaMet } from '#lib/lobby-card.js';
  import { session } from '#lib/session.svelte.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import Avatar from './Avatar.svelte';
  import Lock from './icons/Lock.svelte';
  import Star from './icons/Star.svelte';
  import MembershipPill from './MembershipPill.svelte';
  import StatusPill from './StatusPill.svelte';

  interface Props {
    lobby: LobbyCardDto;
    /**
     * featured: the brand-gradient first card of the feed (and the wizard preview);
     * default: a feed or «Мои» card; compact: a row in the map's place sheet.
     */
    variant?: 'featured' | 'default' | 'compact';
    /** Where the card leads (the lobby page by default); null renders no link (the wizard preview). */
    href?: string | null;
    /** Shown under the card, outside its link (the host's «3 новые заявки →»). */
    footer?: Snippet;
    /** Brief highlight of a just-created card («Мои» after publishing). */
    glow?: boolean;
  }

  let { lobby, variant = 'default', href, footer, glow = false }: Props = $props();

  const link = $derived(href === undefined ? `/lobby/${lobby.id}` : href);

  const category = $derived(LOBBY_CATEGORY_INFO[lobby.category]);
  const when = $derived(formatLobbyStart(lobby.startsAt, clock.now));
  const seats = $derived(formatSeats(lobby.slots, lobby.approvedCount));
  const viewerKarma = $derived(session.state.status === 'ready' ? session.state.user.karma : null);
  const karmaMet = $derived(minKarmaMet(lobby, viewerKarma));
  const featured = $derived(variant === 'featured');
  const time = $derived(formatMoscowTime(lobby.startsAt));
</script>

{#snippet place()}
  <span class="inline-flex items-center gap-1.5">
    {#if lobby.place.lineColor}
      <span
        class="size-2.5 shrink-0 rounded-full {featured ? 'ring-1 ring-paper/70' : ''}"
        style:background-color={lobby.place.lineColor}
        aria-hidden="true"
      ></span>
    {/if}
    {lobby.place.hint}
  </span>
{/snippet}

{#snippet body()}
  {#if variant === 'compact'}
    <div class="flex items-center gap-3">
      <span
        class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/20 text-[0.9375rem] font-bold"
      >
        {time}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[0.9375rem] font-semibold">{lobby.title}</span>
        <span class="block truncate text-[0.8125rem] text-gray-light">
          {category.title} · {seats.toLowerCase()}
        </span>
      </span>
    </div>
  {:else}
    <div class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between gap-2">
        <StatusPill {lobby} onBrand={featured} />
        <span class="truncate text-[0.8125rem] font-medium {featured ? 'text-paper' : 'text-gray-light'}">
          {category.emoji}
          {category.title}
        </span>
      </div>
      <h3
        class="leading-tight break-words {featured ? 'text-[1.375rem] font-bold' : 'text-xl font-semibold'}"
      >
        {lobby.title}
      </h3>
      <p class="flex flex-wrap items-center gap-x-1.5 text-sm {featured ? 'text-paper' : 'text-gray-light'}">
        <span>{when}</span>
        <span aria-hidden="true">·</span>
        {@render place()}
        {#if lobby.distanceM !== null}
          <span aria-hidden="true">·</span>
          <span>{formatDistance(lobby.distanceM)}</span>
        {/if}
        {#if lobby.place.farFromMetro}
          <span aria-hidden="true">·</span>
          <span>далеко от метро</span>
        {/if}
      </p>
      <div class="mt-1 flex items-center gap-2 text-[0.8125rem]">
        <Avatar name={lobby.host.firstName} src={lobby.host.photoUrl} size={28} />
        <span class="flex min-w-0 flex-1 items-center gap-1 {featured ? 'text-paper' : 'text-gray-light'}">
          <span class="truncate">{lobby.host.firstName}</span>
          <span aria-hidden="true">·</span>
          <Star size={12} strokeWidth={1.5} class={featured ? 'text-paper' : 'text-brand'} />
          <span>{lobby.host.karma}</span>
        </span>
        <span class="shrink-0 font-semibold">{seats}</span>
      </div>
      {#if lobby.minKarma !== null || lobby.viewer.membershipStatus}
        <div class="flex flex-wrap gap-2">
          {#if lobby.minKarma !== null}
            <span
              class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs {karmaMet
                ? featured
                  ? 'border-paper/60 text-paper'
                  : 'border-brand text-paper'
                : 'border-gray-dark text-gray-light'}"
            >
              {#if !karmaMet}<Lock size={12} />{/if}
              Карма {lobby.minKarma}+
            </span>
          {/if}
          <MembershipPill
            status={lobby.viewer.membershipStatus}
            applyBlock={lobby.viewer.applyBlock}
            onBrand={featured}
          />
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<article
  class="overflow-hidden text-paper transition-shadow duration-700 {variant === 'compact'
    ? 'rounded-2xl bg-gray-dark/50'
    : featured
      ? 'bg-brand-card rounded-3xl'
      : 'rounded-3xl border border-gray-dark bg-gray-dark/40'} {glow
    ? 'shadow-[0_0_0_3px_var(--color-brand)]'
    : ''}"
>
  {#if link}
    <a href={link} class="block {variant === 'compact' ? 'p-3' : 'p-[1.125rem]'}">{@render body()}</a>
  {:else}
    <div class={variant === 'compact' ? 'p-3' : 'p-[1.125rem]'}>{@render body()}</div>
  {/if}
  {#if footer}
    <div class="border-t {featured ? 'border-paper/20' : 'border-gray-dark'}">{@render footer()}</div>
  {/if}
</article>
