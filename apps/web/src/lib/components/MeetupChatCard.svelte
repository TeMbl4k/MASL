<script lang="ts">
  import type { LobbyChatDto } from '@masl/shared';
  import { api } from '#lib/api.js';
  import { session } from '#lib/session.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { openInTelegram } from '#lib/tg/links.js';
  import Chat from './icons/Chat.svelte';

  interface Props {
    lobbyId: string;
    chat: LobbyChatDto;
    isHost: boolean;
  }

  let { lobbyId, chat, isHost }: Props = $props();

  let busy = $state(false);

  /** The bot sends the host a group picker button; the page reloads the chat on return. */
  async function create() {
    if (busy) return;
    busy = true;
    try {
      const { botLink } = await session.authorized((token) =>
        api.prepareChat(token, lobbyId, { via: 'bot' }),
      );
      toast.show('Бот прислал кнопку: выберите или создайте группу', 'info', 5000);
      openInTelegram(botLink);
    } catch (error) {
      toast.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<!-- The meetup group: the host links it, approved members join through the bot. -->
<section
  aria-labelledby="meetup-chat-title"
  class="flex flex-col gap-3 rounded-[1.125rem] border border-gray-dark bg-gray-dark/40 p-4"
>
  <div class="flex items-center gap-2.5">
    <Chat size={22} class={chat.state === 'linked' && isHost ? 'text-success' : 'text-brand'} />
    <div class="flex min-w-0 flex-col gap-0.5">
      <h2 id="meetup-chat-title" class="font-semibold">
        {chat.state === 'linked' && isHost ? 'Чат подключён' : 'Чат встречи'}
      </h2>
      {#if chat.state === 'linked' && chat.title}
        <span class="truncate text-[0.8125rem] text-gray-light">«{chat.title}»</span>
      {:else if !isHost && chat.state === 'linked'}
        <span class="text-[0.8125rem] text-gray-light">Бот примет заявку на вступление сам</span>
      {/if}
    </div>
  </div>

  {#if chat.state === 'linked' && chat.inviteLink}
    {@const link = chat.inviteLink}
    <button
      type="button"
      class="flex min-h-11 items-center justify-center rounded-[0.875rem] bg-gray-dark text-[0.9375rem] font-medium"
      onclick={() => openInTelegram(link)}
    >
      {isHost ? 'Открыть чат' : 'Вступить в чат'}
    </button>
  {:else if isHost}
    <p class="text-sm leading-relaxed text-paper/80">
      Создайте группу в Telegram. Бот пустит туда только одобренных участников и сам разошлёт им ссылку.
    </p>
    <button
      type="button"
      class="min-h-12 rounded-[0.875rem] bg-brand text-[0.9375rem] font-bold text-paper disabled:opacity-50"
      disabled={busy}
      aria-busy={busy}
      onclick={() => void create()}
    >
      Создать чат встречи
    </button>
    <span class="text-center text-xs text-gray-light">
      Бот пришлёт кнопку в личные сообщения: там можно создать новую группу или выбрать свою
    </span>
  {:else}
    <p class="text-sm text-gray-light">Хост ещё не создал чат. Ссылку пришлёт бот.</p>
  {/if}
</section>
