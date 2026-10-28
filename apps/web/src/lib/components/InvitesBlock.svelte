<script lang="ts">
  import type { MyInviteDto } from '@masl/shared';
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import { session } from '#lib/session.svelte.js';
  import { myLobbies } from '#lib/stores/my-lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { askWriteAccess } from '#lib/tg/write-access.js';
  import LobbyCard from './LobbyCard.svelte';

  /** Pending invites to the viewer; answered and expired ones stay out of «Мои». */
  let invites = $state<MyInviteDto[]>([]);
  let busyId = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      const { items } = await session.authorized((token) => api.myInvites(token));
      invites = items.filter((invite) => invite.state === 'pending');
    } catch {
      // The block is an extra on «Мои»: without it the page still works.
    }
  }

  onMount(() => void load());

  async function answer(invite: MyInviteDto, accept: boolean): Promise<void> {
    if (busyId) return;
    busyId = invite.id;
    try {
      await session.authorized((token) =>
        accept ? api.acceptInvite(token, invite.id) : api.declineInvite(token, invite.id),
      );
      if (accept) {
        haptic.success();
        toast.show(
          invite.byHost ? 'Вы участник. Точный адрес пришлёт бот' : 'Заявка отправлена. Решает организатор',
          'success',
          5000,
        );
        void askWriteAccess();
        myLobbies.invalidate();
      } else {
        toast.show('Приглашение отклонено');
      }
    } catch (error) {
      toast.error(error);
    } finally {
      busyId = null;
      void load();
    }
  }
</script>

{#if invites.length > 0}
  <section class="flex flex-col gap-3" aria-labelledby="my-invites">
    <h2 id="my-invites" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
      Приглашения · {invites.length}
    </h2>
    <ul class="flex flex-col gap-3">
      {#each invites as invite (invite.id)}
        {#snippet actions()}
          <div class="flex flex-col gap-2 px-[1.125rem] py-3">
            <span class="text-[0.8125rem] text-gray-light">
              Зовёт {invite.from.firstName}{invite.byHost
                ? ', организатор'
                : ' · после «Иду» решит организатор'}
            </span>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="min-h-11 rounded-xl bg-brand font-semibold text-paper disabled:opacity-50"
                disabled={busyId !== null}
                aria-busy={busyId === invite.id}
                onclick={() => void answer(invite, true)}
              >
                Иду
              </button>
              <button
                type="button"
                class="min-h-11 rounded-xl border border-gray-dark disabled:opacity-50"
                disabled={busyId !== null}
                onclick={() => void answer(invite, false)}
              >
                Не смогу
              </button>
            </div>
          </div>
        {/snippet}
        <li><LobbyCard lobby={invite.lobby} footer={actions} /></li>
      {/each}
    </ul>
  </section>
{/if}
