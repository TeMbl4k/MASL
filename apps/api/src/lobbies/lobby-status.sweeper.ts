import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { lobbies, type Database } from '@masl/db';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { formatRedacted, redactError } from '../errors/redacting-exception.filter.js';

/** Next to MIGRATION_LOCK_ID (7_302_514) of packages/db. */
const LOBBY_STATUS_LOCK_ID = 7_302_515;
const SWEEP_INTERVAL_MS = 60_000;

export interface SweepResult {
  started: string[];
  finished: string[];
}

/**
 * Persists the time-driven statuses (open → active → finished) by CLOCK. Every decision reads
 * the effective status anyway; this keeps the stored cache close and gives Stage 3 the ids of
 * lobbies that just started or finished. A stored cancelled is never touched.
 */
@Injectable()
export class LobbyStatusSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('LobbyStatusSweeper');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    // Tests call sweep() themselves.
    if (this.env.NODE_ENV === 'test') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One scheduled run: a failure is logged in the redacted shape and never thrown. */
  async tick(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.log.error(formatRedacted('обновления статусов встреч', redactError(error)));
    }
  }

  /**
   * Moves statuses under a transaction-level advisory lock (works behind a transaction pooler,
   * unlike a session lock); a concurrent run gets empty lists. Under READ COMMITTED an UPDATE
   * re-checks its WHERE after waiting on a row, so each id is returned once and a lobby
   * cancelled meanwhile no longer matches.
   */
  async sweep(): Promise<SweepResult> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${LOBBY_STATUS_LOCK_ID}) as locked`,
      );
      if (!row?.locked) return { started: [], finished: [] };
      const started = await tx
        .update(lobbies)
        .set({ status: 'active', updatedAt: now })
        .where(and(eq(lobbies.status, 'open'), lte(lobbies.startsAt, now), gt(lobbies.endsAt, now)))
        .returning({ id: lobbies.id });
      const finished = await tx
        .update(lobbies)
        .set({ status: 'finished', updatedAt: now })
        .where(and(inArray(lobbies.status, ['open', 'active']), lte(lobbies.endsAt, now)))
        .returning({ id: lobbies.id });
      return { started: started.map((r) => r.id), finished: finished.map((r) => r.id) };
    });
  }
}
