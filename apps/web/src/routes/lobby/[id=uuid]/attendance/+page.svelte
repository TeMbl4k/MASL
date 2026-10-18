<script lang="ts">
  import { attendanceSaveLabel, formatMoscowTime, KARMA, type AttendanceResponse } from '@masl/shared';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { page } from '$app/state';
  import { api, ApiError } from '#lib/api.js';
  import { attendanceCounts, canMarkAbsent, initialAbsent } from '#lib/attendance.js';
  import Avatar from '#lib/components/Avatar.svelte';
  import BottomAction from '#lib/components/BottomAction.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import Lock from '#lib/components/icons/Lock.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { describeError, isAbort } from '#lib/errors.js';
  import { formatLobbyWhen, formatShortDate } from '#lib/format/datetime.js';
  import { session } from '#lib/session.svelte.js';
  import { appActivity, clock } from '#lib/stores/clock.svelte.js';
  import { lobbyCache } from '#lib/stores/lobbies.svelte.js';
  import { toast } from '#lib/stores/toast.svelte.js';
  import { haptic } from '#lib/tg/haptics.js';
  import { confirm } from '#lib/tg/popup.js';
  import { usePrimaryAction } from '#lib/tg/primary-action.svelte.js';

  const signed = (delta: number) => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`);

  const id = $derived(page.params.id ?? '');

  let data = $state<AttendanceResponse | null>(null);
  /** The host's marks on this screen; sent as a whole on save. */
  const absent = new SvelteSet<string>();
  let failure = $state<'not-host' | 'not-found' | null>(null);
  let loadError = $state<string | null>(null);
  let saving = $state(false);
  let controller: AbortController | null = null;

  const counts = $derived(data ? attendanceCounts(data.members, absent) : { present: 0, absent: 0 });

  function show(next: AttendanceResponse, keepMarks: boolean): void {
    if (!keepMarks || next.state !== 'open') {
      absent.clear();
      for (const applicationId of initialAbsent(next.members)) absent.add(applicationId);
    }
    data = next;
  }

  async function load(): Promise<void> {
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      const next = await session.authorized((token) => api.attendance(token, id, current.signal));
      // Coming back to the screen keeps what the host already toggled here.
      show(next, data?.lobby.id === id);
      failure = null;
      loadError = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        failure = error.status === 403 ? 'not-host' : 'not-found';
        return;
      }
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      else loadError = shown.text;
    }
  }

  $effect(() => {
    void id;
    if (appActivity.active) untrack(() => void load());
  });

  function toggle(applicationId: string, present: boolean): void {
    haptic.select();
    if (present) absent.delete(applicationId);
    else absent.add(applicationId);
  }

  async function save(): Promise<void> {
    if (saving || !data) return;
    const confirmed = await confirm({
      title: 'Сохранить отметки?',
      message: `На встрече ${counts.present}, не было ${counts.absent}. Изменить отметки потом будет нельзя.`,
      confirmText: 'Сохранить',
    });
    if (!confirmed) return;
    saving = true;
    try {
      const saved = await session.authorized((token) => api.saveAttendance(token, id, [...absent]));
      show(saved, false);
      haptic.success();
      lobbyCache.attendanceSaved();
      toast.show('Сохранено, карма начислена', 'success');
    } catch (error) {
      toast.error(error);
      void load();
    } finally {
      saving = false;
    }
  }

  const primary = usePrimaryAction(() => ({
    text: attendanceSaveLabel(counts.present, counts.absent),
    visible: data?.state === 'open' && data.members.length > 0,
    state: saving ? 'loading' : 'ready',
    onClick: () => void save(),
  }));
</script>

<svelte:head>
  <title>Кто пришёл — MASL</title>
</svelte:head>

<main class="min-h-dvh pb-10">
  {#if failure}
    <PageHeader title={failure === 'not-host' ? 'Это не ваша встреча' : 'Встреча не найдена'} />
    <div class="px-5 pt-4">
      <a href="/" class="inline-block rounded-2xl bg-brand px-6 py-3 text-lg font-bold text-paper"
        >На главную</a
      >
    </div>
  {:else if !data}
    <PageHeader title="Кто пришёл" />
    <div class="flex flex-col gap-3 px-5 pt-4">
      {#if loadError}
        <ErrorState title="Не удалось загрузить список" message={loadError} onretry={() => void load()} />
      {:else}
        <div class="h-20 animate-pulse rounded-3xl bg-gray-dark/40" aria-busy="true"></div>
        <div class="h-20 animate-pulse rounded-3xl bg-gray-dark/40"></div>
      {/if}
    </div>
  {:else}
    {@const state = data.state}
    <PageHeader
      eyebrow="Кто пришёл"
      title={data.lobby.title}
      subtitle="{formatLobbyWhen(data.lobby.startsAt, data.lobby.endsAt, clock.now)}{state === 'open'
        ? ` · отметить можно до ${formatShortDate(data.deadline)}, ${formatMoscowTime(data.deadline)}`
        : ''}"
    />

    <div class="flex flex-col gap-5 px-5 pt-5">
      <p class="text-sm leading-relaxed text-paper/80" role="status">
        {#if state === 'not_yet'}
          Отметить, кто пришёл, можно после окончания встречи.
        {:else if state === 'open'}
          Все отмечены как пришедшие. Выключите тех, кого не было. Отметки окончательные.
        {:else if state === 'saved'}
          Отметки сохранены, карма начислена.
        {:else}
          Время отметить вышло. Карму получили только те, кто отметился на месте.
        {/if}
      </p>

      {#if data.members.length === 0}
        <p class="text-sm text-gray-light">На встрече не было одобренных участников.</p>
      {:else}
        <ul class="flex flex-col gap-2.5">
          {#each data.members as member (member.applicationId)}
            {@const toggleable = canMarkAbsent(member, state)}
            {@const missing =
              member.status === 'no_show' ||
              (member.status === 'approved' && absent.has(member.applicationId))}
            <li>
              <label
                class="flex min-h-16 items-center gap-3 rounded-[1.125rem] px-3.5 py-3 {missing
                  ? 'border border-dashed border-gray bg-gray-dark/20'
                  : 'border border-gray-dark bg-gray-dark/40'}"
              >
                <Avatar name={member.user.firstName} src={member.user.photoUrl} size={40} />
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate font-semibold {missing ? 'text-paper/75' : ''}"
                    >{member.user.firstName}</span
                  >
                  <span class="text-[0.8125rem] {member.checkedInAt ? 'text-success' : 'text-gray-light'}">
                    {#if member.checkedInAt}
                      Отметка «Я на месте» в {formatMoscowTime(member.checkedInAt)}
                    {:else if member.status === 'attended'}
                      на встрече · {signed(KARMA.ATTENDED)}
                    {:else if missing}
                      не было · карма {signed(KARMA.NO_SHOW)}
                    {:else}
                      карма {member.user.karma} · на встрече
                    {/if}
                  </span>
                </span>
                {#if toggleable}
                  <input
                    type="checkbox"
                    class="size-[1.375rem] accent-brand"
                    checked={!absent.has(member.applicationId)}
                    aria-label="{member.user.firstName} на встрече"
                    onchange={(event) => toggle(member.applicationId, event.currentTarget.checked)}
                  />
                {:else if member.checkedInAt && state === 'open'}
                  <span class="text-gray-light" role="img" aria-label="Изменить нельзя"
                    ><Lock size={18} /></span
                  >
                {/if}
              </label>
            </li>
          {/each}
        </ul>
        {#if state === 'open'}
          <p class="text-center text-[0.8125rem] text-gray-light">
            Пришедшим {signed(KARMA.ATTENDED)}, не пришедшим {signed(KARMA.NO_SHOW)}, вам {signed(
              KARMA.HOSTED,
            )} за встречу
          </p>
        {/if}
      {/if}
    </div>
  {/if}

  {#if primary.fallback}
    <BottomAction {...primary.fallback} />
  {/if}
</main>
