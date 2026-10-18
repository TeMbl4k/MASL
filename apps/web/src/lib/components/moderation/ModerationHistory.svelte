<script lang="ts">
  import type { ModerationLogEntryDto } from '@masl/shared';
  import { formatLogTime, historyTitle } from '#lib/moderation.js';

  let { items }: { items: ModerationLogEntryDto[] } = $props();
</script>

<section class="flex flex-col gap-3" aria-labelledby="moderation-history-title">
  <h2 id="moderation-history-title" class="text-[0.8125rem] tracking-widest text-gray-light uppercase">
    История модерации
  </h2>
  {#if items.length === 0}
    <p class="text-sm text-gray-light">Записей нет</p>
  {:else}
    <ol class="flex flex-col divide-y divide-gray-dark rounded-2xl border border-gray-dark bg-gray-dark/40">
      {#each items as entry (entry.id)}
        <li class="flex flex-col gap-0.5 px-4 py-3 text-sm">
          <span class="text-xs text-gray-light">
            {formatLogTime(entry.createdAt)} · {entry.actor ? entry.actor.firstName : 'автоматически'}
          </span>
          <span>
            {#if entry.caseId}
              <a href="/admin/case/{entry.caseId}" class="underline underline-offset-2"
                >{historyTitle(entry)}</a
              >
            {:else}
              {historyTitle(entry)}
            {/if}
            {#if entry.lobby}<span class="text-gray-light"> · «{entry.lobby.title}»</span>{/if}
          </span>
          {#if entry.comment}
            <span class="break-words whitespace-pre-line text-gray-light">{entry.comment}</span>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>
