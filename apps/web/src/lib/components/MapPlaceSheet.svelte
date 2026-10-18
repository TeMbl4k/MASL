<script lang="ts">
  import { plural, LOBBY_FORMS } from '#lib/format/plural.js';
  import type { MapPlace } from '#lib/map/group-places.js';
  import LobbyCard from './LobbyCard.svelte';
  import Sheet from './Sheet.svelte';

  interface Props {
    /** The tapped place; null when it left the map data (filters changed). */
    place: MapPlace | null;
  }

  let { place }: Props = $props();
</script>

{#snippet lineDots()}
  {#if place && place.lineColors.length > 0}
    <span class="flex shrink-0 gap-1" aria-hidden="true">
      {#each place.lineColors as color (color)}
        <span class="size-2.5 rounded-full" style:background-color={color}></span>
      {/each}
    </span>
  {/if}
{/snippet}

<Sheet
  name="map-place"
  title={place ? `${place.hint} · ${plural(place.lobbies.length, LOBBY_FORMS)}` : 'Встречи'}
  titlePrefix={lineDots}
>
  {#if place}
    <ul class="flex flex-col gap-2.5">
      {#each place.lobbies as lobby (lobby.id)}
        <li><LobbyCard {lobby} variant="compact" /></li>
      {/each}
    </ul>
  {:else}
    <p class="text-gray-light">Здесь больше нет встреч с такими фильтрами.</p>
  {/if}
</Sheet>
