<script lang="ts">
  import { formatRetryAfter, type CreationContextDto } from '@masl/shared';
  import { plural, type PluralForms } from '#lib/format/plural.js';
  import { clock } from '#lib/stores/clock.svelte.js';
  import Alert from '../icons/Alert.svelte';
  import WizardBack from './WizardBack.svelte';

  interface Props {
    /** A context with `canCreate: false`. */
    context: CreationContextDto;
  }

  let { context }: Props = $props();

  const LOBBY_FORMS_ACC: PluralForms = ['встречу', 'встречи', 'встреч'];
  const UPCOMING_FORMS: PluralForms = ['предстоящая встреча', 'предстоящие встречи', 'предстоящих встреч'];

  const retry = $derived(context.retryAt ? formatRetryAfter(context.retryAt, clock.now) : null);

  /** Full-screen copy per reason (spec §9.7). */
  const copy = $derived.by((): { title: string; text: string; link: 'my' | 'home' } => {
    switch (context.reason) {
      case 'daily_limit':
        return context.isNewbie
          ? {
              title: 'Сегодня вы уже создали встречу',
              text: `Новички могут создавать одну встречу в сутки.${retry ? ` Следующую можно создать ${retry}.` : ''}`,
              link: 'my',
            }
          : {
              title: `Сегодня вы уже создали ${plural(context.createdInWindow, LOBBY_FORMS_ACC)}`,
              text: `Можно создавать не больше ${plural(context.dailyLimit, LOBBY_FORMS_ACC)} в сутки.${
                retry ? ` Следующую — ${retry}.` : ''
              }`,
              link: 'my',
            };
      case 'upcoming_limit':
        return {
          title: `У вас уже ${plural(context.upcomingCount, UPCOMING_FORMS)}`,
          text: 'Дождитесь их или отмените одну, чтобы создать новую.',
          link: 'my',
        };
      case 'blocked':
        return {
          title: 'Создание встреч приостановлено',
          text: 'Возможность обжаловать появится позже.',
          link: 'home',
        };
      default:
        return { title: 'Сначала заполните профиль', text: 'Без него встречу не создать.', link: 'home' };
    }
  });
</script>

<main class="bg-brand-glow flex min-h-dvh flex-col px-5 pt-5">
  <WizardBack />
  <div class="mx-auto flex max-w-sm flex-1 flex-col items-center justify-center gap-4 pb-24 text-center">
    <Alert size={36} class="text-brand" />
    <h1 tabindex="-1" class="text-[1.75rem] leading-tight font-light tracking-tight outline-none">
      {copy.title}
    </h1>
    <p class="text-gray-light">{copy.text}</p>
    <a
      href={copy.link === 'my' ? '/my?tab=hosting' : '/'}
      class="mt-2 flex min-h-12 items-center rounded-2xl bg-brand px-6 text-lg font-bold text-paper"
    >
      {copy.link === 'my' ? 'К моим событиям' : 'На главную'}
    </a>
  </div>
</main>
