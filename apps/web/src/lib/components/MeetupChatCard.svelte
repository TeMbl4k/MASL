<script lang="ts">
  import type { LobbyChatDto } from '@masl/shared';
  import { api } from '#lib/api.js';
  import { session } from '#lib/session.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { openInTelegram } from '#lib/tg/links.js';
  import { canRequestChat, requestChat } from '#lib/tg/request-chat.js';
  import Chat from './icons/Chat.svelte';

  interface Props {
    lobbyId: string;
    chat: LobbyChatDto;
    isHost: boolean;
  }

  let { lobbyId, chat, isHost }: Props = $props();

  /** The bot links the group a moment after Telegram hands it over. */
  const RELOAD_AFTER_MS = [1500, 5000];

  const inApp = canRequestChat();
  let busy = $state(false);

  /**
   * Telegram's group picker right here (`app`), or a picker button in the bot's private chat
   * (`bot`) for older clients and when the picker didn't open.
   */
  async function create(via: 'app' | 'bot') {
    if (busy) return;
    busy = true;
    try {
      const { preparedButtonId, botLink } = await session.authorized((token) =>
        api.prepareChat(token, lobbyId, { via }),
      );
      if (preparedButtonId) {
        busy = false;
        if (await requestChat(preparedButtonId)) {
          toast.show('Группа выбрана, подключаем чат', 'success');
          for (const delay of RELOAD_AFTER_MS) {
            setTimeout(() => void lobbyCache.load(lobbyId).catch(() => undefined), delay);
          }
        }
        return;
      }
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
      onclick={() => void create(inApp ? 'app' : 'bot')}
    >
      Создать чат встречи
    </button>
    {#if inApp}
      <button
        type="button"
        class="min-h-11 text-center text-xs text-gray-light underline underline-offset-2"
        disabled={busy}
        onclick={() => void create('bot')}
      >
        Не открылось? Пришлём кнопку в личку бота
      </button>
    {:else}
      <span class="text-center text-xs text-gray-light">
        Бот пришлёт кнопку в личные сообщения: там можно создать новую группу или выбрать свою
      </span>
    {/if}
  {:else}
    <p class="text-sm text-gray-light">Хост ещё не создал чат. Ссылку пришлёт бот.</p>
  {/if}
</section>
