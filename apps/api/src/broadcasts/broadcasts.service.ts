import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { GrammyError, type Bot } from 'grammy';
import {
  broadcasts,
  broadcastUnsubscribes,
  lobbies,
  notifications,
  userInterests,
  users,
  type Database,
} from '@masl/db';
import {
  BROADCAST_GAP_HOURS,
  BROADCASTS_LIST_MAX,
  HOUR_MS,
  effectiveLobbyStatus,
  type BroadcastAudienceDto,
  type BroadcastDto,
  type BroadcastInput,
  type BroadcastsResponse,
  type BroadcastTestResponse,
} from '@masl/shared';
import { AppLinks } from '../bot/app-links.js';
import { BOT } from '../bot/bot.provider.js';
import { broadcastMarkup } from '../bot/outbox.renderer.js';
import { OutboxService } from '../bot/outbox.service.js';
import { describeTelegramError } from '../bot/telegram-errors.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { hostUser, type Executor } from '../lobbies/lobby-queries.js';

/** One send at a time, so two broadcasts can't both pass the one-per-gap check of a person. */
const SEND_LOCK = sql`pg_advisory_xact_lock(hashtext('masl:broadcast'))`;

/**
 * «Рассылки» (stage 7): the admin's news to people who keep «Новости MASL» on. A person gets at
 * most one broadcast in BROADCAST_GAP_HOURS; messages go through the outbox behind the ones
 * about meetups, and the renderer checks the subscription again at send time.
 */
@Injectable()
export class BroadcastsService {
  private readonly log = new Logger(BroadcastsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(AppLinks) private readonly links: AppLinks,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Who would get it now and whom it skips, each person counted once. */
  async audience(interests: string[] | null): Promise<BroadcastAudienceDto> {
    const [row] = await this.db.execute<{
      unsubscribed: number;
      bot_blocked: number;
      recent: number;
      recipients: number;
    }>(sql`
      select
        count(*) filter (where not u.news_enabled)::int as unsubscribed,
        count(*) filter (where u.news_enabled and not u.allows_write_to_pm)::int as bot_blocked,
        count(*) filter (where u.news_enabled and u.allows_write_to_pm and ${this.recentSql()})::int as recent,
        count(*) filter (where u.news_enabled and u.allows_write_to_pm and not ${this.recentSql()})::int as recipients
      from ${users} u
      where ${this.audienceSql(interests)}`);
    return {
      recipients: Number(row?.recipients ?? 0),
      skipped: {
        unsubscribed: Number(row?.unsubscribed ?? 0),
        botBlocked: Number(row?.bot_blocked ?? 0),
        recent: Number(row?.recent ?? 0),
      },
    };
  }

  async list(): Promise<BroadcastsResponse> {
    const rows = await this.db.execute<{
      id: string;
      text: string;
      interests: string[] | null;
      lobby_id: string | null;
      lobby_title: string | null;
      created_at: string | Date;
      author_id: string | null;
      author_name: string | null;
      recipients: number;
      delivered: number;
      failed: number;
      pending: number;
      unsubscribed: number;
    }>(sql`
      select b.id, b.text, b.interests, b.lobby_id, l.title as lobby_title, b.created_at,
        a.id as author_id, a.first_name as author_name,
        (select count(*)::int from ${notifications} n where n.broadcast_id = b.id) as recipients,
        (select count(*)::int from ${notifications} n
          where n.broadcast_id = b.id and n.telegram_message_id is not null) as delivered,
        (select count(*)::int from ${notifications} n
          where n.broadcast_id = b.id and n.failed_at is not null) as failed,
        (select count(*)::int from ${notifications} n
          where n.broadcast_id = b.id and n.sent_at is null and n.failed_at is null) as pending,
        (select count(*)::int from ${broadcastUnsubscribes} s where s.broadcast_id = b.id) as unsubscribed
      from ${broadcasts} b
      left join ${lobbies} l on l.id = b.lobby_id
      left join ${users} a on a.id = b.author_id
      order by b.created_at desc, b.id desc
      limit ${BROADCASTS_LIST_MAX}`);
    const [people] = await this.db.execute<{ total: number; subscribed: number }>(sql`
      select count(*)::int as total, count(*) filter (where u.news_enabled)::int as subscribed
      from ${users} u where ${this.audienceSql(null)}`);
    return {
      items: rows.map((r): BroadcastDto => ({
        id: r.id,
        text: r.text,
        interests: r.interests,
        lobby: r.lobby_id && r.lobby_title ? { id: r.lobby_id, title: r.lobby_title } : null,
        createdAt: new Date(r.created_at).toISOString(),
        author: r.author_id && r.author_name ? { id: r.author_id, firstName: r.author_name } : null,
        recipients: Number(r.recipients),
        delivered: Number(r.delivered),
        failed: Number(r.failed),
        pending: Number(r.pending),
        unsubscribed: Number(r.unsubscribed),
      })),
      people: { total: Number(people?.total ?? 0), subscribed: Number(people?.subscribed ?? 0) },
    };
  }

  /** Queues the broadcast for everyone it reaches now; returns the history. */
  async send(adminId: string, input: BroadcastInput): Promise<BroadcastsResponse> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select ${SEND_LOCK}`);
      if (input.lobbyId) await this.requireOpenLobby(tx, input.lobbyId, now);
      const [broadcast] = await tx
        .insert(broadcasts)
        .values({
          authorId: adminId,
          text: input.text,
          interests: input.interests,
          lobbyId: input.lobbyId,
          createdAt: now,
        })
        .returning({ id: broadcasts.id });
      const recipients = await tx.execute<{ id: string }>(sql`
        select u.id from ${users} u
        where ${this.audienceSql(input.interests)} and u.news_enabled and u.allows_write_to_pm
          and not ${this.recentSql(now)}
        order by u.id`);
      await this.outbox.enqueue(
        tx,
        recipients.map((r) => ({
          kind: 'user_broadcast' as const,
          userId: r.id,
          broadcastId: broadcast!.id,
        })),
        now,
      );
    });
    return this.list();
  }

  /** «Отправить себе»: the draft goes to the admin at once, with the same buttons. */
  async test(adminId: string, input: BroadcastInput): Promise<BroadcastTestResponse> {
    const now = this.clock.now();
    if (input.lobbyId) await this.requireOpenLobby(this.db, input.lobbyId, now);
    const [admin] = await this.db
      .select({ telegramId: users.telegramId, allowsWriteToPm: users.allowsWriteToPm })
      .from(users)
      .where(eq(users.id, adminId));
    if (!admin?.allowsWriteToPm) throw apiError('bot_blocked');
    try {
      await this.bot.api.sendMessage(admin.telegramId, input.text, {
        reply_markup: await broadcastMarkup(this.links, input.lobbyId, null),
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      this.log.warn(`Бот: проверка рассылки не отправлена: ${describeTelegramError(error)}`);
      throw apiError(
        error instanceof GrammyError && error.error_code === 403 ? 'bot_blocked' : 'bot_unavailable',
      );
    }
    return { sent: true };
  }

  /**
   * «Отписаться от новостей» from a bot button; true when it turned the news off. The
   * broadcast it came from counts the unsubscribe.
   */
  async unsubscribe(userId: string, broadcastId: string | null): Promise<boolean> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const changed = await tx
        .update(users)
        .set({ newsEnabled: false, updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.newsEnabled, true)))
        .returning({ id: users.id });
      if (changed.length === 0) return false;
      if (broadcastId) {
        await tx.execute(sql`
          insert into ${broadcastUnsubscribes} (broadcast_id, user_id, created_at)
          select ${broadcastId}, ${userId}, ${now.toISOString()}::timestamptz
          where exists (select 1 from ${broadcasts} where id = ${broadcastId})
          on conflict do nothing`);
      }
      return true;
    });
  }

  /** «Открыть встречу» leads to a lobby that is still gathering, of a host without a ban. */
  private async requireOpenLobby(db: Executor, lobbyId: string, now: Date): Promise<void> {
    const [lobby] = await db
      .select({
        status: lobbies.status,
        startsAt: lobbies.startsAt,
        endsAt: lobbies.endsAt,
        hostBanned: hostUser.isShadowBanned,
      })
      .from(lobbies)
      .innerJoin(hostUser, eq(hostUser.id, lobbies.hostId))
      .where(eq(lobbies.id, lobbyId));
    if (!lobby || lobby.hostBanned) throw apiError('lobby_not_found');
    if (effectiveLobbyStatus(lobby, now) !== 'open') throw apiError('lobby_closed');
  }

  /** Onboarded people without a shadow ban, with one of the interests when there are any. */
  private audienceSql(interests: string[] | null): SQL {
    const base = sql`u.onboarded_at is not null and not u.is_shadow_banned`;
    if (!interests) return base;
    return sql`${base} and exists (
      select 1 from ${userInterests} ui where ui.user_id = u.id and ui.interest_slug in ${interests})`;
  }

  /** The person already got a broadcast within BROADCAST_GAP_HOURS. */
  private recentSql(now: Date = this.clock.now()): SQL {
    const since = new Date(now.getTime() - BROADCAST_GAP_HOURS * HOUR_MS).toISOString();
    return sql`exists (
      select 1 from ${notifications} n
      where n.user_id = u.id and n.kind = 'user_broadcast' and n.failed_at is null
        and n.created_at > ${since}::timestamptz)`;
  }
}
