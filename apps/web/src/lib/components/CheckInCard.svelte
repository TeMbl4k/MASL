<script lang="ts">
  import { CHECK_IN_RADIUS_M, formatMoscowTime, type CheckInDto } from '@masl/shared';
  import { clock } from '#lib/stores/clock.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { openLocationSettings, requestUserLocation } from '#lib/tg/location.js';
  import Check from './icons/Check.svelte';
  import Pin from './icons/Pin.svelte';

  interface Props {
    lobbyId: string;
    checkIn: CheckInDto;
  }

  let { lobbyId, checkIn }: Props = $props();

  let busy = $state(false);
  const opensAt = $derived(new Date(checkIn.opensAt).getTime());
  const isOpen = $derived(clock.now >= opensAt && clock.now < new Date(checkIn.closesAt).getTime());

  /** The position goes to the API once and is not kept; the answer never says how far it is. */
  async function mark() {
    if (busy) return;
    busy = true;
    try {
      const location = await requestUserLocation();
      if (location.kind === 'denied') {
        toast.show('Нужен доступ к геолокации, чтобы отметиться', 'error', 5000);
        if (location.settings) openLocationSettings();
        return;
      }
      if (location.kind === 'unavailable') {
        toast.show('Не удалось определить, где вы. Попробуйте ещё раз', 'error');
        return;
      }
      await lobbyCache.checkIn(lobbyId, { lat: location.lat, lng: location.lng });
      haptic.success();
      toast.show('Вы отметились на месте', 'success');
    } catch (error) {
      haptic.error();
      toast.error(error);
    } finally {
      busy = false;
    }
  }
</script>

{#if checkIn.checkedInAt}
  <div
    class="flex items-center gap-2.5 rounded-2xl border border-success/40 bg-success/10 px-4 py-3.5"
    role="status"
  >
    <Check size={20} strokeWidth={2.6} class="text-success" />
    <span class="text-[0.9375rem]">Вы отметились на месте в {formatMoscowTime(checkIn.checkedInAt)}</span>
  </div>
{:else}
  <div class="flex flex-col gap-2">
    <button
      type="button"
      class="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-base font-bold text-paper disabled:opacity-50"
      disabled={!isOpen || busy}
      aria-busy={busy}
      onclick={() => void mark()}
    >
      <Pin size={20} strokeWidth={2.2} />
      Я на месте
    </button>
    <span class="text-center text-[0.8125rem] leading-snug text-gray-light">
      {#if isOpen}
        Отметьтесь, когда придёте: нужна геолокация, до места не дальше {CHECK_IN_RADIUS_M} м. С отметкой хост не
        сможет поставить вам неявку.
      {:else}
        Отметиться можно с {formatMoscowTime(checkIn.opensAt)}, когда будете на месте.
      {/if}
    </span>
  </div>
{/if}
