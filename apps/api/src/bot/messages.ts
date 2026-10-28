import {
  ACHIEVEMENT_TEXTS,
  KARMA,
  LATE_CANCEL_WINDOW_HOURS,
  LOBBY_CANCEL_REASON_LABELS,
  attendanceSaveLabel,
  formatMoscow,
  formatMoscowTime,
  type Achievement,
  type Instant,
  type LobbyCancelReasonOut,
} from '@masl/shared';

/**
 * Russian texts of the bot. Plain text (no parse_mode), so titles and names can't inject markup.
 * People are named by first name only, and no phrase about another person depends on gender.
 */

/** «пт, 16 октября, 19:30–21:30»: absolute, since a message is read later than it is sent. */
export function formatMeetupWhen(startsAt: Instant, endsAt: Instant): string {
  const day = formatMoscow(startsAt, { weekday: 'short', day: 'numeric', month: 'long' });
  return `${day}, ${formatMoscowTime(startsAt)}–${formatMoscowTime(endsAt)}`;
}

/** «18 октября, 21:30». */
export function formatDeadline(at: Instant): string {
  return `${formatMoscow(at, { day: 'numeric', month: 'long' })}, ${formatMoscowTime(at)}`;
}

const signed = (delta: number) => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`);

export interface MeetupRef {
  title: string;
  startsAt: Instant;
  endsAt: Instant;
}

export interface ApplicantLine {
  firstName: string;
  karma: number;
  isNewbie: boolean;
}

export const texts = {
  start: () =>
    'Привет! Это MASL: спонтанные встречи в Москве. Здесь бот пришлёт точный адрес встречи, ответ хоста на заявку и ссылку на чат встречи.',
  openAppHint: 'Откройте приложение кнопкой меню.',
  unknownUser: 'Откройте приложение, чтобы войти',

  hostNewApplications: (m: MeetupRef & { slots: number; approved: number }, applicants: ApplicantLine[]) =>
    [
      `Новые заявки на «${m.title}»:`,
      ...applicants.map((a) => `${a.firstName} · карма ${a.karma}${a.isNewbie ? ' · новичок' : ''}`),
      '',
      `Занято ${m.approved} из ${m.slots}. ${formatMeetupWhen(m.startsAt, m.endsAt)}`,
    ].join('\n'),

  hostMemberLeft: (m: MeetupRef & { slots: number; approved: number }, firstName: string) =>
    `${firstName} больше не идёт на «${m.title}». Освободилось место: занято ${m.approved} из ${m.slots}.`,

  hostQuorumCheck: (m: MeetupRef & { slots: number; approved: number }) =>
    [
      `«${m.title}» начнётся в ${formatMoscowTime(m.startsAt)}.`,
      `Занято ${m.approved} из ${m.slots}. Если людей не хватает, можно снизить порог кармы или отменить встречу.`,
      'Сейчас отмена без штрафа.',
    ].join('\n'),
  quorumLower: (minKarma: number | null) =>
    minKarma === null ? 'Убрать порог кармы' : `Снизить порог кармы до ${minKarma}`,
  quorumLowered: (minKarma: number | null) =>
    minKarma === null
      ? 'Готово: порога кармы больше нет, подать заявку может любой.'
      : `Готово: порог кармы теперь ${minKarma}.`,
  quorumCancelConfirm: (title: string, penalized: boolean) =>
    penalized
      ? `Отменить «${title}»? Все места уже заняты, и до начала меньше часа: карма снизится на ${Math.abs(KARMA.HOST_LATE_CANCEL)}, а создавать встречи станет нельзя.`
      : `Отменить «${title}»? Сейчас без штрафа.`,
  quorumCancelled: 'Встреча отменена, участникам сообщили.',
  quorumKept: 'Хорошо, проводим.',
  notActual: 'Это уже неактуально.',

  memberApproved: (m: MeetupRef & { address: string }) =>
    [
      `Вас приняли на «${m.title}»!`,
      formatMeetupWhen(m.startsAt, m.endsAt),
      `Точный адрес: ${m.address}`,
      '',
      `Если планы изменятся, отмените участие в приложении. Позже чем за ${LATE_CANCEL_WINDOW_HOURS} часа до начала карма снизится на ${Math.abs(KARMA.LATE_CANCEL)}.`,
    ].join('\n'),
  memberRejected: (title: string) =>
    `Заявку на «${title}» не приняли. Загляните в ленту: там есть и другие встречи.`,
  memberLobbyCancelled: (m: MeetupRef, reason: LobbyCancelReasonOut | null, comment: string | null) =>
    [
      `Встречу «${m.title}» (${formatMeetupWhen(m.startsAt, m.endsAt)}) отменили.`,
      reason ? `Причина: ${LOBBY_CANCEL_REASON_LABELS[reason]}.` : null,
      comment ? `Комментарий хоста: ${comment}` : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  memberChatReady: (title: string) =>
    `У встречи «${title}» появился чат. Нажмите «Вступить в чат», бот примет заявку сам.`,

  hostAttendancePoll: (m: MeetupRef, deadline: Instant, many: boolean) =>
    [
      `Как прошла «${m.title}»?`,
      many
        ? 'Отметьте в приложении, кого не было.'
        : 'Нажмите на тех, кого не было, и сохраните. Отметившихся на месте отметить отсутствующими нельзя.',
      `Пришедшим ${signed(KARMA.ATTENDED)} к карме, не пришедшим ${signed(KARMA.NO_SHOW)}, вам ${signed(KARMA.HOSTED)}. Отметить можно до ${formatDeadline(deadline)}.`,
    ].join('\n'),
  attendanceSave: attendanceSaveLabel,
  attendanceSaved: (present: number, absent: number) =>
    `Сохранено: на встрече ${present}, не было ${absent}. Карма начислена.`,
  attendanceCheckedIn: 'Отметка «Я на месте» есть, изменить нельзя',
  hostAttendanceReminder: (title: string, deadline: Instant) =>
    `Отметьте, кто пришёл на «${title}», до ${formatDeadline(deadline)}. Если не отметить, ${signed(KARMA.ATTENDED)} получат только те, кто отметился на месте.`,
  memberAttendanceResult: (title: string, outcome: 'attended' | 'no_show' | 'checked_in', delta: number) =>
    outcome === 'attended'
      ? `По отметке хоста вы были на «${title}». Карма ${signed(delta)}.`
      : outcome === 'checked_in'
        ? `Вы отметились на месте на «${title}». Карма ${signed(delta)}.`
        : `По отметке хоста вас не было на «${title}». Карма ${signed(delta)}. Если это ошибка, обжаловать можно будет позже.`,
  memberFeedbackRequest: (title: string, hostName: string) => `Как прошла встреча «${title}» от ${hostName}?`,
  feedbackThanks: 'Спасибо!',
  feedbackAlready: 'Уже записали',

  groupWelcome: (m: MeetupRef) =>
    `Это чат встречи «${m.title}», ${formatMeetupWhen(m.startsAt, m.endsAt)}. Сюда попадают только одобренные участники. Точный адрес каждому пришёл в личку от бота.`,
  groupFinished: (title: string) =>
    `Встреча «${title}» закончилась. Спасибо, что пришли! Ссылка-приглашение больше не работает, бот выйдет из группы через 2 дня.`,
  groupCancelled: (title: string) =>
    `Встречу «${title}» отменили. Ссылка-приглашение больше не работает, бот выйдет из группы через 2 дня.`,

  chatLinked: (title: string, hasPeople: boolean) =>
    [
      `Чат подключён к «${title}». Бот пустит в группу только одобренных участников и разошлёт им ссылку.`,
      hasPeople ? 'В группе уже есть люди: они увидят переписку участников.' : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  chatRequestStale: 'Ссылка устарела. Нажмите «Создать чат встречи» в приложении ещё раз.',
  chatTaken: 'Эта группа уже подключена к другой встрече. Создайте новую группу.',
  chatMissingRights: (missing: string[]) =>
    `Боту нужны права администратора в группе: ${missing.join(', ')}. Выдайте их и нажмите «Создать чат встречи» ещё раз.`,
  chatRightsLost: (title: string, missing: string[]) =>
    `В чате встречи «${title}» у бота нет прав: ${missing.join(', ')}. Без них бот не сможет пускать участников.`,
  chatPickerPrompt: 'Нажмите кнопку ниже и выберите или создайте группу для встречи.',
  chatPickerButton: 'Выбрать группу',

  moderatorShadowBan: (firstName: string, reports: number, reasons: string[]) =>
    `Теневой бан для ${firstName}. Жалоб: ${reports} (${reasons.join(', ')}).`,
  moderatorAppeal: (firstName: string) => `Новая апелляция от ${firstName}.`,
  moderatorNotHeld: (title: string) => `Встреча «${title}» могла не состояться: так ответил участник.`,
  userAppealApproved: (refund: number | null) =>
    [
      'Блокировку создания встреч сняли. Можно снова собирать людей.',
      refund ? `Карму вернули: ${signed(refund)}.` : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  userAppealRejected: (reason: string, retryAt: Instant) =>
    `Апелляцию отклонили: ${reason}. Повторно можно с ${formatMoscow(retryAt, { day: 'numeric', month: 'long' })}.`,

  // The share card goes to any chat: public data only, never the exact place.
  shareLobby: (m: MeetupRef & { placeHint: string; free: number; slots: number }) =>
    [
      `«${m.title}»`,
      formatMeetupWhen(m.startsAt, m.endsAt),
      m.placeHint,
      m.free > 0 ? `Свободно мест: ${m.free} из ${m.slots}` : 'Мест пока нет',
      '',
      'Спонтанные встречи в Москве — MASL',
    ].join('\n'),
  shareLobbyButton: 'Открыть встречу',
  shareProfile: (firstName: string, karma: number) =>
    [`${firstName} в MASL · карма ${karma}`, '', 'Спонтанные встречи в Москве — MASL'].join('\n'),
  shareProfileButton: 'Открыть профиль',

  userInvite: (
    m: MeetupRef & { placeHint: string; free: number; slots: number },
    from: string,
    byHost: boolean,
  ) =>
    [
      byHost ? `${from} зовёт вас на свою встречу «${m.title}»` : `${from} зовёт вас на «${m.title}»`,
      formatMeetupWhen(m.startsAt, m.endsAt),
      m.placeHint,
      `Свободно мест: ${m.free} из ${m.slots}`,
      '',
      byHost
        ? 'Нажмите «Иду», и место ваше: точный адрес придёт сюда.'
        : 'Нажмите «Иду», и мы отправим заявку: решение за хостом.',
    ].join('\n'),
  inviteAccept: 'Иду',
  inviteDecline: 'Не смогу',
  inviteOptOut: 'Не приглашать меня',
  inviteGoing: 'Место ваше! Точный адрес — в следующем сообщении.',
  inviteApplied: 'Заявка отправлена, хост скоро ответит.',
  inviteDeclined: 'Хорошо, в другой раз.',
  inviteOptedOut: 'Больше не будем звать вас на встречи. Включить приглашения можно в профиле.',

  feedbackPrompt: 'Расскажите, что улучшить, что сломалось или что непонятно. Ответ придёт сюда.',
  feedbackButton: 'Написать нам',
  adminNewSupport: (category: string, firstName: string, text: string) =>
    [`Новое обращение · ${category} · ${firstName}`, '', text].join('\n'),
  userSupportReply: (reply: string) => ['Ответ на ваше обращение:', '', reply].join('\n'),

  userAchievements: (
    earned: readonly Achievement[],
    next: { id: Achievement; current: number; goal: number } | null,
  ) =>
    [
      earned.length === 1
        ? `Новая ачивка: «${ACHIEVEMENT_TEXTS[earned[0]!].title}»`
        : `Новые ачивки: ${earned.map((id) => `«${ACHIEVEMENT_TEXTS[id].title}»`).join(', ')}`,
      ...earned.map((id) => ACHIEVEMENT_TEXTS[id].praise),
      next ? `Следующая — «${ACHIEVEMENT_TEXTS[next.id].title}»: ${next.current} из ${next.goal}.` : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  achievementsButton: 'Мои ачивки',
  // «Друг» is what the verb agrees with, whoever the friend is.
  userFriendCounted: (companionName: string | null, arrived: number, reached: number) =>
    [
      companionName
        ? `Друг по вашей ссылке, ${companionName}, сходил на первую встречу.`
        : 'Друг, который пришёл по вашей ссылке, сходил на первую встречу.',
      `По вашей ссылке пришли: ${arrived}, дошли до встречи: ${reached}.`,
    ].join('\n'),
  userQrPrint:
    'QR вашей визитки для печати. Он ведёт на ваш профиль в MASL, и друзья, пришедшие по нему, засчитываются вам. Печатайте от 2 см.',
  adminTagQrPrint: (title: string) =>
    `QR метки «${title}» для печати. Он ведёт в ленту MASL, новые люди записываются на эту метку.`,

  broadcastOpenApp: 'Открыть MASL',
  broadcastOpenLobby: 'Открыть встречу',
  newsOff: 'Отписаться от новостей',
  newsOffDone:
    'Вы отписались от новостей. Заявки, адреса встреч, приглашения и ачивки будут приходить как раньше.\nВернуть новости можно в профиле: «Новости MASL».',
  newsOffAlready: 'Вы уже отписаны от новостей',
};

/** Admin rights the bot needs in the meetup group, with their names in BotFather's terms. */
export const REQUIRED_CHAT_RIGHTS = {
  can_invite_users: 'приглашать участников',
  can_restrict_members: 'блокировать участников',
} as const;
