import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { Bot } from 'grammy';
import { notifications, users, type Database, type Notification } from '@masl/db';
import { HOUR_MS, type NotificationKind } from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { formatRedacted, redactError } from '../errors/redacting-exception.filter.js';
import type { DbTransaction } from '../karma/karma.service.js';
import { BOT } from './bot.provider.js';
import { OutboxRenderer, type TelegramCall } from './outbox.renderer.js';
import { classifyTelegramError, describeTelegramError } from './telegram-errors.js';

export type OutboxTarget = { userId: string; chatId?: never } | { chatId: number; userId?: never };

export type OutboxMessage = OutboxTarget & {
  kind: NotificationKind;
  lobbyId: string;
  memberId?: string;
  /** Not before this moment; default now. */
  sendAfter?: Date;
  /** At most one pending row per key: a repeat while one waits is dropped (debounce). */
  dedupeKey?: string;
};

const POLL_INTERVAL_MS = 1000;
const BATCH = 20;
/** A claimed row is invisible to other passes for this long; the pass releases it sooner. */
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 30_000;
/** Unsent messages older than this are dropped: the news is stale by then. */
const STALE_MS = 24 * HOUR_MS;
/** Asked and closed by the scheduler's own windows; the renderer skips them once closed. */
const LONG_LIVED: readonly NotificationKind[] = [
  'host_attendance_poll',
  'host_attendance_reminder',
  'member_feedback_request',
  'member_attendance_result',
  'group_leave',
];

/** Telegram's limits (decisions.md): about 30 messages a second, one a second per chat, 20 a minute per group. */
export interface SendPacing {
  globalMs: number;
  privateChatMs: number;
  groupMs: number;
}
const PACING: SendPacing = { globalMs: 40, privateChatMs: 1000, groupMs: 3000 };
const NO_PACING: SendPacing = { globalMs: 0, privateChatMs: 0, groupMs: 0 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Transactional outbox of bot messages. Services enqueue in the transaction of the change, so a
 * message exists exactly when the change committed; the sender delivers it with Telegram's
 * limits, retries and 403 handling. One app instance (decisions.md).
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Bot');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | null = null;
  private readonly lastSent = new Map<string, number>();
  private readonly pacing: SendPacing;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(OutboxRenderer) private readonly renderer: OutboxRenderer,
  ) {
    this.pacing = env.NODE_ENV === 'test' ? NO_PACING : PACING;
  }

  onApplicationBootstrap(): void {
    // Tests call flush() themselves.
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** Queues messages in the caller's transaction. */
  async enqueue(tx: DbTransaction, messages: OutboxMessage[], now: Date): Promise<void> {
    if (messages.length === 0) return;
    await tx
      .insert(notifications)
      .values(
        messages.map((m) => ({
          userId: m.userId ?? null,
          chatId: m.chatId ?? null,
          lobbyId: m.lobbyId,
          memberId: m.memberId ?? null,
          kind: m.kind,
          dedupeKey: m.dedupeKey ?? null,
          sendAfter: m.sendAfter ?? now,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    try {
      await this.flush();
    } catch (error) {
      this.log.error(formatRedacted('отправки сообщений бота', redactError(error)));
    }
  }

  /** Sends what is due now, batch after batch; returns how many rows were handled. */
  async flush(): Promise<number> {
    if (this.running) return this.running;
    this.running = (async () => {
      let handled = 0;
      for (;;) {
        const batch = await this.claim();
        for (const row of batch) await this.deliver(row);
        handled += batch.length;
        if (batch.length < BATCH) return handled;
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Leases due rows so an overlapping pass skips them. */
  private async claim(): Promise<Notification[]> {
    const now = this.clock.now();
    const due = this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(isNull(notifications.sentAt), isNull(notifications.failedAt), lte(notifications.sendAfter, now)),
      )
      .orderBy(asc(notifications.sendAfter), asc(notifications.id))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    return this.db
      .update(notifications)
      .set({ sendAfter: new Date(now.getTime() + LEASE_MS) })
      .where(inArray(notifications.id, due))
      .returning();
  }

  private async deliver(row: Notification): Promise<void> {
    const now = this.clock.now();
    if (now.getTime() - row.createdAt.getTime() > STALE_MS && !LONG_LIVED.includes(row.kind)) {
      await this.finish(row.id, { failedAt: now });
      return;
    }
    let calls: TelegramCall[] | null;
    try {
      calls = await this.renderer.render(row);
    } catch (error) {
      this.log.error(formatRedacted(`подготовки сообщения ${row.kind}`, redactError(error)));
      await this.retryLater(row, now, null);
      return;
    }
    if (!calls) {
      // Nothing true to say any more: done without a message.
      await this.finish(row.id, { sentAt: now });
      return;
    }

    const chatKey = row.userId !== null ? `u:${row.userId}` : `g:${row.chatId}`;
    const gap = row.userId !== null ? this.pacing.privateChatMs : this.pacing.groupMs;
    const last = this.lastSent.get(chatKey);
    if (last !== undefined && now.getTime() - last < gap) {
      await this.finish(row.id, { sendAfter: new Date(last + gap) });
      return;
    }

    let messageId: number | null = null;
    for (const [index, call] of calls.entries()) {
      try {
        if (this.pacing.globalMs > 0) await sleep(this.pacing.globalMs);
        const result = await (this.bot.api.raw[call.method] as (payload: unknown) => Promise<unknown>)(
          call.payload,
        );
        if (messageId === null && typeof result === 'object' && result !== null && 'message_id' in result) {
          messageId = Number(result.message_id);
        }
      } catch (error) {
        const failure = classifyTelegramError(error);
        if (failure.kind === 'permanent' && index > 0) {
          // The main part went out; a follow-up (the venue after the text) is not worth a repeat.
          this.log.warn(`Бот: ${row.kind}, часть не отправлена: ${describeTelegramError(error)}`);
          continue;
        }
        this.log.warn(`Бот: ${row.kind} не отправлено: ${describeTelegramError(error)}`);
        if (failure.kind === 'rate_limited') {
          await this.finish(row.id, {
            sendAfter: new Date(now.getTime() + failure.retryAfterSeconds * 1000),
          });
        } else if (failure.kind === 'transient') {
          await this.retryLater(row, now, failure.code);
        } else {
          await this.finish(row.id, { failedAt: now, lastErrorCode: failure.code });
          if (failure.code === 403 && row.userId !== null) {
            await this.db.update(users).set({ allowsWriteToPm: false }).where(eq(users.id, row.userId));
          }
        }
        return;
      }
    }
    this.lastSent.set(chatKey, this.clock.now().getTime());
    await this.finish(row.id, { sentAt: now, telegramMessageId: messageId });
  }

  private async retryLater(row: Notification, now: Date, code: number | null): Promise<void> {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.finish(row.id, { attempts, failedAt: now, lastErrorCode: code });
      return;
    }
    const sendAfter = new Date(now.getTime() + BACKOFF_MS * 2 ** (attempts - 1));
    await this.finish(row.id, { attempts, sendAfter, lastErrorCode: code });
  }

  /** Updates a claimed row: sent, failed, or pending again with a new send_after. */
  private async finish(
    id: number,
    patch: Partial<
      Pick<
        Notification,
        'sentAt' | 'failedAt' | 'sendAfter' | 'attempts' | 'lastErrorCode' | 'telegramMessageId'
      >
    >,
  ): Promise<void> {
    await this.db.update(notifications).set(patch).where(eq(notifications.id, id));
  }
}
