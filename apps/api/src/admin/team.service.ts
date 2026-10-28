import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { linkTags, lobbyMembers, moderationActions, userArrivals, users, type Database } from '@masl/db';
import {
  type AdminTeamResponse,
  type LinkTagInput,
  type LinkTagsResponse,
  type TeamMemberDto,
} from '@masl/shared';
import { AppLinks } from '../bot/app-links.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';

const teamUserColumns = {
  id: users.id,
  telegramId: users.telegramId,
  firstName: users.firstName,
  username: users.username,
};

/**
 * «Команда и метки» (stage 6). Admins come from ADMIN_TELEGRAM_IDS only; moderators are
 * appointed and removed from the user card (the grant_moderator/revoke_moderator actions).
 */
@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(AppLinks) private readonly links: AppLinks,
  ) {}

  /** Admins in the order of the setting, then moderators by name. */
  async team(): Promise<AdminTeamResponse> {
    const adminIds = this.env.ADMIN_TELEGRAM_IDS;
    const admins = adminIds.length
      ? await this.db
          .select(teamUserColumns)
          .from(users)
          .where(inArray(users.telegramId, [...adminIds]))
      : [];
    const moderators = await this.db
      .select({ ...teamUserColumns, since: max(moderationActions.createdAt) })
      .from(users)
      .leftJoin(
        moderationActions,
        and(eq(moderationActions.subjectId, users.id), eq(moderationActions.action, 'grant_moderator')),
      )
      .where(eq(users.isModerator, true))
      .groupBy(users.id)
      .orderBy(asc(users.firstName), asc(users.id));
    const person = (u: (typeof admins)[number]) => ({
      id: u.id,
      firstName: u.firstName,
      username: u.username,
    });
    const items: TeamMemberDto[] = [
      ...adminIds.map((telegramId) => {
        const user = admins.find((a) => a.telegramId === telegramId);
        return { role: 'admin' as const, telegramId, user: user ? person(user) : null, since: null };
      }),
      ...moderators
        .filter((m) => !adminIds.includes(m.telegramId))
        .map((m) => ({
          role: 'moderator' as const,
          telegramId: m.telegramId,
          user: person(m),
          since: m.since?.toISOString() ?? null,
        })),
    ];
    return { items };
  }

  /** Link tags, newest first, with their all-time arrivals and how many of them attended. */
  async tags(): Promise<LinkTagsResponse> {
    const rows = await this.db
      .select({
        id: linkTags.id,
        slug: linkTags.slug,
        title: linkTags.title,
        createdAt: linkTags.createdAt,
        arrivals: count(userArrivals.userId),
        attended: sql<number>`count(${userArrivals.userId}) filter (where exists (
          select 1 from ${lobbyMembers} m where m.user_id = ${userArrivals.userId} and m.status = 'attended'))`.mapWith(
          Number,
        ),
      })
      .from(linkTags)
      .leftJoin(userArrivals, eq(userArrivals.tagId, linkTags.id))
      .groupBy(linkTags.id)
      .orderBy(desc(linkTags.createdAt), desc(linkTags.id));
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        link: await this.links.tagLink(row.slug),
        arrivals: row.arrivals,
        attended: row.attended,
        createdAt: row.createdAt.toISOString(),
      })),
    );
    return { items };
  }

  async createTag(adminId: string, input: LinkTagInput): Promise<LinkTagsResponse> {
    const inserted = await this.db
      .insert(linkTags)
      .values({ slug: input.slug, title: input.title, createdBy: adminId, createdAt: this.clock.now() })
      .onConflictDoNothing()
      .returning({ id: linkTags.id });
    if (inserted.length === 0) throw apiError('tag_exists');
    return this.tags();
  }
}
