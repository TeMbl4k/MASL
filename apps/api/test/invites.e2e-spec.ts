import { and, eq } from 'drizzle-orm';
import { lobbyInvites, lobbyMembers, notifications, users } from '@masl/db';
import {
  INVITES_PER_DAY_MAX,
  INVITE_MESSAGES_PER_DAY_MAX,
  LOBBY_PENDING_INVITES_MAX,
  PERSON_SEARCHES_PER_HOUR,
  apiErrorDto,
  hostApplicationsResponse,
  inviteAnswerResponse,
  inviteCandidatesResponse,
  lobbyDetailDto,
  myInvitesResponse,
  sendInvitesResponse,
  type ApiErrorCode,
  type AuthResponse,
  type MeDto,
} from '@masl/shared';
import {
  CANARY_ADDRESS,
  adminUrl,
  assertNoExactPlace,
  authHeader,
  bootApp,
  freshTelegramId,
  insertLobby,
  makeOutboxDue,
  setMembership,
  setUser,
  type InjectResponse,
  type TestApp,
} from './helpers.js';

type Person = AuthResponse & { user: MeDto };

describe.skipIf(!adminUrl)('invites e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  const adminTelegramId = freshTelegramId();

  beforeAll(async () => {
    t = await bootApp({ env: { ADMIN_TELEGRAM_IDS: String(adminTelegramId) } });
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    t.telegram.reset();
  });

  const get = (token: string, url: string) =>
    t.app.inject({ method: 'GET', url, headers: authHeader(token) });
  const post = (token: string, url: string, payload: object = {}) =>
    t.app.inject({ method: 'POST', url, headers: authHeader(token), payload });
  const candidates = (token: string, lobbyId: string, query: string) =>
    get(token, `/api/lobbies/${lobbyId}/invite-candidates?${query}`);
  const invite = (token: string, lobbyId: string, codes: string[]) =>
    post(token, `/api/lobbies/${lobbyId}/invites`, { codes });
  const mine = async (token: string) => myInvitesResponse.parse((await get(token, '/api/me/invites')).json());
  const inviteIdOf = async (lobbyId: string, inviteeId: string) => {
    const [row] = await t.db
      .select({ id: lobbyInvites.id })
      .from(lobbyInvites)
      .where(and(eq(lobbyInvites.lobbyId, lobbyId), eq(lobbyInvites.inviteeId, inviteeId)));
    return row!.id;
  };
  const tap = (telegramId: number, data: string) =>
    t.handleUpdate({
      callback_query: {
        id: String(Math.random()),
        from: { id: telegramId, is_bot: false, first_name: 'Тест' },
        chat_instance: 'chat',
        data,
        message: {
          message_id: 10,
          date: 0,
          chat: { id: telegramId, type: 'private', first_name: 'Тест' },
          text: 'Приглашение',
        },
      },
    });

  function expectError(response: InjectResponse, status: number, code: ApiErrorCode) {
    expect(response.statusCode, response.body).toBe(status);
    expect(apiErrorDto.parse(response.json()).code).toBe(code);
    assertNoExactPlace(response.json(), code);
  }

  /** An onboarded user the bot may write to, optionally with a username. */
  async function person(firstName: string, username?: string, telegramId?: number): Promise<Person> {
    const p = await t.loginOnboarded(telegramId, firstName);
    await t.db
      .update(users)
      .set({ allowsWriteToPm: true, username: username ?? null })
      .where(eq(users.id, p.user.id));
    return p;
  }

  /** Makes `a` and `b` companions: both present at a finished meetup of `a`. */
  async function meet(a: Person, b: Person) {
    const past = await insertLobby(t.db, { hostId: a.user.id, startsInMin: -24 * 60 });
    await setMembership(t.db, past.id, b.user.id, 'attended');
  }

  describe('search', () => {
    it('finds people by the start of the first name or @username, name and photo only', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 4 });
      const zlata = await person('Злата', 'zlata_k');
      await person('Златомира');
      const hidden = await person('Златан');
      await t.db.update(users).set({ hideFromSearch: true }).where(eq(users.id, hidden.user.id));
      const banned = await person('Златослава');
      await setUser(t.db, banned.user.id, { isShadowBanned: true });
      const optedOut = await person('Златоуста');
      await t.db.update(users).set({ invitesEnabled: false }).where(eq(users.id, optedOut.user.id));
      const fresh = await t.login(undefined, 'Златоцвета');

      const byName = inviteCandidatesResponse.parse(
        (await candidates(host.token, lobby.id, 'q=злат')).json(),
      );
      expect(byName.items.map((i) => i.person.firstName)).toEqual(['Злата', 'Златомира']);
      expect(byName.items.map((i) => i.person.firstName)).not.toContain(fresh.user.firstName);
      for (const item of byName.items) {
        expect(Object.keys(item.person).sort()).toEqual(['code', 'firstName', 'photoUrl']);
      }
      expect(byName).toMatchObject({ freeSlots: 4, invitesLeft: INVITES_PER_DAY_MAX });

      const byUsername = inviteCandidatesResponse.parse(
        (await candidates(host.token, lobby.id, `q=${encodeURIComponent('@zlata')}`)).json(),
      );
      expect(byUsername.items).toEqual([
        {
          person: { code: zlata.user.publicCode, firstName: 'Злата', photoUrl: null },
          companion: false,
          state: 'available',
        },
      ]);
      // LIKE wildcards are literal.
      const wildcard = inviteCandidatesResponse.parse(
        (await candidates(host.token, lobby.id, 'q=%25%25%25')).json(),
      );
      expect(wildcard.items).toEqual([]);
    });

    it('wants at least 3 characters for everyone, none for companions', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      expect((await candidates(host.token, lobby.id, 'q=ab')).statusCode).toBe(400);
      expect((await candidates(host.token, lobby.id, 'filter=all')).statusCode).toBe(400);
      expect((await candidates(host.token, lobby.id, 'filter=companions')).statusCode).toBe(200);
    });

    it('lists companions, including those who hide from search, with their state', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 4 });
      const [shy, going, stranger] = await Promise.all([person('Тихоня'), person('Идущий'), person('Чужой')]);
      await t.db.update(users).set({ hideFromSearch: true }).where(eq(users.id, shy.user.id));
      await meet(host, shy);
      await meet(going, host);
      await setMembership(t.db, lobby.id, going.user.id, 'approved');

      const body = inviteCandidatesResponse.parse(
        (await candidates(host.token, lobby.id, 'filter=companions')).json(),
      );
      expect(body.items.map((i) => [i.person.firstName, i.companion, i.state]).sort()).toEqual([
        ['Идущий', true, 'going'],
        ['Тихоня', true, 'available'],
      ]);
      expect(body.items.map((i) => i.person.firstName)).not.toContain(stranger.user.firstName);
      // The search over everyone still hides the shy companion.
      const search = inviteCandidatesResponse.parse(
        (await candidates(host.token, lobby.id, 'q=Тихо')).json(),
      );
      expect(search.items).toEqual([]);
    });

    it(`limits searches to ${PERSON_SEARCHES_PER_HOUR} an hour, but not for the team`, async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      for (let i = 0; i < PERSON_SEARCHES_PER_HOUR; i++) {
        expect((await candidates(host.token, lobby.id, 'q=Кто')).statusCode).toBe(200);
      }
      expectError(await candidates(host.token, lobby.id, 'q=Кто'), 429, 'searches_limit');
      // The companions list isn't a search.
      expect((await candidates(host.token, lobby.id, 'filter=companions')).statusCode).toBe(200);

      const admin = await person('Админ', undefined, adminTelegramId);
      const own = await insertLobby(t.db, { hostId: admin.user.id });
      for (let i = 0; i <= PERSON_SEARCHES_PER_HOUR; i++) {
        expect((await candidates(admin.token, own.id, 'q=Кто')).statusCode).toBe(200);
      }
    });
  });

  describe('a host invite', () => {
    it('makes the invitee a member on «Иду», past the karma threshold; the address comes in the DM', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 3, minKarma: 80 });
      const guest = await person('Гость');

      const sent = sendInvitesResponse.parse(
        (await invite(host.token, lobby.id, [guest.user.publicCode])).json(),
      );
      expect(sent).toEqual({ sent: 1, skipped: 0 });
      await makeOutboxDue(t.db);
      await t.flushOutbox();
      const [text] = t.telegram.textsTo(guest.user.telegramId);
      expect(text).toContain('Хост зовёт вас на свою встречу «Тестовая встреча»');
      expect(text).not.toContain(CANARY_ADDRESS);
      const [call] = t.telegram.sent('sendMessage', guest.user.telegramId);
      const buttons = JSON.stringify(call!.payload.reply_markup);
      expect(buttons).toContain('Иду');
      expect(buttons).toContain('Не приглашать меня');

      const detail = lobbyDetailDto.parse((await get(guest.token, `/api/lobbies/${lobby.id}`)).json());
      expect(detail.invite).toMatchObject({ byHost: true, from: 'Хост' });
      expect(detail.access).toBe('public');

      const inviteId = await inviteIdOf(lobby.id, guest.user.id);
      const answer = inviteAnswerResponse.parse(
        (await post(guest.token, `/api/me/invites/${inviteId}/accept`)).json(),
      );
      expect(answer.invite).toMatchObject({ state: 'accepted', byHost: true });
      assertNoExactPlace(answer, 'accept answer');
      const [member] = await t.db
        .select({ status: lobbyMembers.status, inviteId: lobbyMembers.inviteId })
        .from(lobbyMembers)
        .where(and(eq(lobbyMembers.lobbyId, lobby.id), eq(lobbyMembers.userId, guest.user.id)));
      expect(member).toEqual({ status: 'approved', inviteId });

      t.telegram.reset();
      await makeOutboxDue(t.db);
      await t.flushOutbox();
      expect(t.telegram.textsTo(guest.user.telegramId).join('\n')).toContain(CANARY_ADDRESS);
      const after = lobbyDetailDto.parse((await get(guest.token, `/api/lobbies/${lobby.id}`)).json());
      expect(after.access).toBe('member');
      expect(after.invite).toBeNull();
      // A repeat is harmless.
      expect((await post(guest.token, `/api/me/invites/${inviteId}/accept`)).statusCode).toBe(200);
    });

    it('works from the bot, and «Не приглашать меня» turns invites off', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 3 });
      const [yes, no] = await Promise.all([person('Да'), person('Нет')]);
      await invite(host.token, lobby.id, [yes.user.publicCode, no.user.publicCode]);

      await tap(yes.user.telegramId, `i:y:${await inviteIdOf(lobby.id, yes.user.id)}`);
      await tap(no.user.telegramId, `i:off:${await inviteIdOf(lobby.id, no.user.id)}`);
      const answers = t.telegram.sent('answerCallbackQuery').map((c) => c.payload.text);
      expect(answers).toEqual([
        'Место ваше! Точный адрес — в следующем сообщении.',
        'Больше не будем звать вас на встречи. Включить приглашения можно в профиле.',
      ]);
      const [state] = await t.db
        .select({ invitesEnabled: users.invitesEnabled })
        .from(users)
        .where(eq(users.id, no.user.id));
      expect(state!.invitesEnabled).toBe(false);
      const second = await insertLobby(t.db, { hostId: host.user.id });
      expect(
        sendInvitesResponse.parse((await invite(host.token, second.id, [no.user.publicCode])).json()),
      ).toEqual({
        sent: 0,
        skipped: 1,
      });
    });

    it('expires when places run out, and never comes twice', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 1 });
      const [late, taker] = await Promise.all([person('Опоздавший'), person('Успевший')]);
      await invite(host.token, lobby.id, [late.user.publicCode]);
      expect(
        sendInvitesResponse.parse((await invite(host.token, lobby.id, [late.user.publicCode])).json()),
      ).toEqual({
        sent: 0,
        skipped: 1,
      });
      await setMembership(t.db, lobby.id, taker.user.id, 'approved');

      const [item] = (await mine(late.token)).items;
      expect(item).toMatchObject({ state: 'expired', lobby: { id: lobby.id } });
      const inviteId = await inviteIdOf(lobby.id, late.user.id);
      expectError(await post(late.token, `/api/me/invites/${inviteId}/accept`), 409, 'invite_expired');
      expectError(await invite(host.token, lobby.id, [late.user.publicCode]), 409, 'lobby_full');
    });
  });

  describe('a member invite', () => {
    it('becomes an application «по приглашению», and keeps the karma threshold', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 4, minKarma: 50 });
      const member = await person('Мария');
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      const [friend, lowKarma] = await Promise.all([person('Друг'), person('Новичок')]);
      await t.db.update(users).set({ karma: 40 }).where(eq(users.id, lowKarma.user.id));

      const sent = sendInvitesResponse.parse(
        (await invite(member.token, lobby.id, [friend.user.publicCode, lowKarma.user.publicCode])).json(),
      );
      expect(sent).toEqual({ sent: 2, skipped: 0 });

      const friendInvite = await inviteIdOf(lobby.id, friend.user.id);
      const answer = inviteAnswerResponse.parse(
        (await post(friend.token, `/api/me/invites/${friendInvite}/accept`)).json(),
      );
      expect(answer.invite).toMatchObject({ state: 'accepted', byHost: false, from: { firstName: 'Мария' } });
      const list = hostApplicationsResponse.parse(
        (await get(host.token, `/api/lobbies/${lobby.id}/applications`)).json(),
      );
      expect(list.pending).toEqual([expect.objectContaining({ invitedBy: 'Мария' })]);

      const lowInvite = await inviteIdOf(lobby.id, lowKarma.user.id);
      expectError(await post(lowKarma.token, `/api/me/invites/${lowInvite}/accept`), 403, 'karma_too_low');
      expect((await mine(lowKarma.token)).items[0]).toMatchObject({ state: 'pending' });
    });

    it('is not open to applicants, rejected people or strangers', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 4 });
      const [pending, stranger, target] = await Promise.all([
        person('Ждущий'),
        person('Чужой'),
        person('Цель'),
      ]);
      await setMembership(t.db, lobby.id, pending.user.id, 'pending');
      for (const who of [pending, stranger]) {
        expectError(await invite(who.token, lobby.id, [target.user.publicCode]), 403, 'invite_not_allowed');
        expectError(await candidates(who.token, lobby.id, 'q=Цел'), 403, 'invite_not_allowed');
      }
    });
  });

  describe('access', () => {
    it('T-IDOR: user B neither sees nor answers user A’s invites', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const [a, b] = await Promise.all([person('Анна'), person('Борис')]);
      await invite(host.token, lobby.id, [a.user.publicCode]);
      const inviteId = await inviteIdOf(lobby.id, a.user.id);

      expect((await mine(b.token)).items).toEqual([]);
      expectError(await post(b.token, `/api/me/invites/${inviteId}/accept`), 404, 'invite_not_found');
      expectError(await post(b.token, `/api/me/invites/${inviteId}/decline`), 404, 'invite_not_found');
      await tap(b.user.telegramId, `i:y:${inviteId}`);
      expect(t.telegram.sent('answerCallbackQuery').at(-1)?.payload.text).toBe('Приглашение не найдено');
      const [row] = await t.db
        .select({ status: lobbyInvites.status })
        .from(lobbyInvites)
        .where(eq(lobbyInvites.id, inviteId));
      expect(row!.status).toBe('pending');
      expect((await mine(a.token)).items).toHaveLength(1);
    });

    it('hides the invite of an inviter who gets shadow-banned', async () => {
      const host = await person('Хост');
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const member = await person('Скрытый');
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      const guest = await person('Гость');
      await invite(member.token, lobby.id, [guest.user.publicCode]);
      await setUser(t.db, member.user.id, { isShadowBanned: true });

      expect((await mine(guest.token)).items).toEqual([]);
      const detail = lobbyDetailDto.parse((await get(guest.token, `/api/lobbies/${lobby.id}`)).json());
      expect(detail.invite).toBeNull();
      await makeOutboxDue(t.db);
      await t.flushOutbox();
      expect(t.telegram.textsTo(guest.user.telegramId)).toEqual([]);
    });
  });

  describe('limits', () => {
    async function people(n: number, name: string) {
      const list: Person[] = [];
      for (let i = 0; i < n; i++) list.push(await person(`${name}${i}`));
      return list;
    }

    it(`caps a person at ${INVITES_PER_DAY_MAX} invites a day; a moderator has no cap until revoked`, async () => {
      const host = await person('Хост');
      const lobbyA = await insertLobby(t.db, { hostId: host.user.id, slots: 10 });
      const lobbyB = await insertLobby(t.db, { hostId: host.user.id, slots: 10 });
      const guests = await people(INVITES_PER_DAY_MAX + 1, 'Гость');
      const codes = guests.map((g) => g.user.publicCode);
      for (const [lobby, chunk] of [
        [lobbyA, codes.slice(0, 10)],
        [lobbyB, codes.slice(10, 20)],
      ] as const) {
        expect((await invite(host.token, lobby.id, [...chunk])).statusCode).toBe(200);
      }
      expectError(await invite(host.token, lobbyA.id, [codes[20]!]), 429, 'invites_daily_limit');

      await setUser(t.db, host.user.id, { isModerator: true });
      expect((await invite(host.token, lobbyA.id, [codes[20]!])).statusCode).toBe(200);
      const left = inviteCandidatesResponse.parse(
        (await candidates(host.token, lobbyA.id, 'filter=companions')).json(),
      );
      expect(left.invitesLeft).toBeNull();

      await setUser(t.db, host.user.id, { isModerator: false });
      const more = await person('Ещё');
      expectError(await invite(host.token, lobbyA.id, [more.user.publicCode]), 429, 'invites_daily_limit');
    });

    it(`keeps at most ${LOBBY_PENDING_INVITES_MAX} unanswered invites per lobby, for the team too`, async () => {
      const admin = await person('Админ', undefined, adminTelegramId + 1);
      await setUser(t.db, admin.user.id, { isModerator: true });
      const lobby = await insertLobby(t.db, { hostId: admin.user.id, slots: 10 });
      const guests = await people(LOBBY_PENDING_INVITES_MAX + 1, 'Зов');
      const codes = guests.map((g) => g.user.publicCode);
      expect((await invite(admin.token, lobby.id, codes.slice(0, 10))).statusCode).toBe(200);
      expect((await invite(admin.token, lobby.id, codes.slice(10, 20))).statusCode).toBe(200);
      expectError(await invite(admin.token, lobby.id, [codes[20]!]), 429, 'lobby_invites_limit');
    });

    it(`sends one person at most ${INVITE_MESSAGES_PER_DAY_MAX} invite messages a day`, async () => {
      const guest = await person('Популярный');
      for (let i = 0; i <= INVITE_MESSAGES_PER_DAY_MAX; i++) {
        const host = await person(`Хост${i}`);
        const lobby = await insertLobby(t.db, { hostId: host.user.id });
        expect(
          sendInvitesResponse.parse((await invite(host.token, lobby.id, [guest.user.publicCode])).json())
            .sent,
        ).toBe(1);
      }
      const queued = await t.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, guest.user.id), eq(notifications.kind, 'user_invite')));
      expect(queued).toHaveLength(INVITE_MESSAGES_PER_DAY_MAX);
      expect((await mine(guest.token)).items).toHaveLength(INVITE_MESSAGES_PER_DAY_MAX + 1);
    });
  });
});
