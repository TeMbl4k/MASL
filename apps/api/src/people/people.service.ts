import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { lobbies, lobbyMembers, userInterests, users, type Database } from '@masl/db';
import {
  COMPANIONS_LIST_MAX,
  PROFILE_LOBBIES_MAX,
  type CompanionsResponse,
  type PublicProfileDto,
} from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { LobbiesService } from '../lobbies/lobbies.service.js';
import { toLobbyCard } from '../lobbies/lobby.mapper.js';
import { discoverableWhere, selectLobbyCards, type Executor } from '../lobbies/lobby-queries.js';
import { areCompanions, companionsOfSql, countCompanions } from './companions.js';

/** The person behind a public code as `viewerId` may see them, or null. */
export async function findPerson(db: Executor, viewerId: string, code: string) {
  const [person] = await db
    .select({
      id: users.id,
      code: users.publicCode,
      firstName: users.firstName,
      photoUrl: users.photoUrl,
      karma: users.karma,
      onboardedAt: users.onboardedAt,
      isShadowBanned: users.isShadowBanned,
    })
    .from(users)
    .where(eq(users.publicCode, code));
  if (!person) return null;
  const isSelf = person.id === viewerId;
  // A shadow-banned person is hidden from everyone else, as their lobbies are.
  if (!isSelf && (person.onboardedAt === null || person.isShadowBanned)) return null;
  return { ...person, isSelf };
}

/** Public profiles and the owner's companions (stage 6). */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
  ) {}

  /**
   * GET /people/:code. No age, gender, username, Telegram id, nor the meetups the person joins:
   * only the open lobbies they host, as the feed would show them to the viewer.
   */
  async profile(viewerId: string, code: string): Promise<PublicProfileDto> {
    const now = this.clock.now();
    const person = await findPerson(this.db, viewerId, code);
    if (!person) throw apiError('person_not_found');
    const viewer = await this.lobbies.viewer(this.db, viewerId, now);
    const hostedWhere = person.isSelf
      ? and(eq(lobbies.hostId, person.id), eq(lobbies.status, 'open'), gt(lobbies.startsAt, now))
      : and(eq(lobbies.hostId, person.id), discoverableWhere(viewerId, now));
    const [cards, interests, hosted, attended, companions, isCompanion] = await Promise.all([
      selectLobbyCards(this.db, viewerId)
        .where(hostedWhere)
        .orderBy(asc(lobbies.startsAt), asc(lobbies.id))
        .limit(PROFILE_LOBBIES_MAX),
      this.db
        .select({ slug: userInterests.interestSlug })
        .from(userInterests)
        .where(eq(userInterests.userId, person.id))
        .orderBy(asc(userInterests.interestSlug)),
      this.db
        .select({ n: count() })
        .from(lobbies)
        .where(
          and(
            eq(lobbies.hostId, person.id),
            // Raw: in a single-table query Drizzle would leave the outer `id` unqualified.
            sql`exists (select 1 from ${lobbyMembers} m where m.lobby_id = ${lobbies}.id and m.status = 'attended')`,
          ),
        ),
      this.db
        .select({ n: count() })
        .from(lobbyMembers)
        .where(and(eq(lobbyMembers.userId, person.id), eq(lobbyMembers.status, 'attended'))),
      countCompanions(this.db, person.id),
      person.isSelf ? false : areCompanions(this.db, viewerId, person.id),
    ]);
    return {
      code: person.code,
      firstName: person.firstName,
      photoUrl: person.photoUrl,
      karma: person.karma,
      hosted: hosted[0]?.n ?? 0,
      attended: attended[0]?.n ?? 0,
      companions,
      interests: interests.map((r) => r.slug),
      lobbies: cards.map((row) => toLobbyCard(row, viewer, now)),
      isSelf: person.isSelf,
      isCompanion,
    };
  }

  /** «Напарники»: the caller's own list only, the most recent meeting first. */
  async companions(userId: string): Promise<CompanionsResponse> {
    const rows = await this.db.execute<{
      code: string;
      first_name: string;
      photo_url: string | null;
      karma: number;
      meetups: number;
      last_met: string | Date;
    }>(sql`
      select ${users.publicCode} as code, ${users.firstName} as first_name, ${users.photoUrl} as photo_url,
        ${users.karma} as karma, c.meetups, c.last_met
      from ${companionsOfSql(userId)} c
      join ${users} on ${users.id} = c.user_id
      order by c.last_met desc, ${users.publicCode}
      limit ${COMPANIONS_LIST_MAX}`);
    return {
      items: rows.map((r) => ({
        person: { code: r.code, firstName: r.first_name, photoUrl: r.photo_url, karma: Number(r.karma) },
        meetups: Number(r.meetups),
        lastMetAt: new Date(r.last_met).toISOString(),
      })),
    };
  }
}
