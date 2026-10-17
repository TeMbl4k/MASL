import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { lobbies, users, type Database, type GeoPoint } from '@masl/db';
import {
  HOSTED_UPCOMING_MAX,
  LOBBIES_PER_DAY_MAX,
  LOBBY_CREATE_WINDOW_HOURS,
  MINUTE_MS,
  NEWBIE_ATTENDED_MIN,
  NEWBIE_LOBBIES_PER_DAY,
  HOUR_MS,
  classifyMetroDistance,
  effectiveLobbyStatus,
  truncateToMinute,
  validateLobbyStart,
  type CancelLobbyInput,
  type CreateBlockReason,
  type CreateLobbyInput,
  type CreationContextDto,
  type LobbyDetailDto,
} from '@masl/shared';
import { nearestStation, placeHint } from '@masl/shared/metro';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { ENV, type Env } from '../config/env.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { resolveLobbyAccess } from './lobby-access.js';
import { toExactPlace, toLobbyDetail, toPerson, membershipOf, type DetailAccess } from './lobby.mapper.js';
import {
  loadCreationCounters,
  loadExactPlace,
  loadLobbyForViewer,
  loadViewerContext,
  lockLobby,
  membersQuery,
  roundOrigin,
  type CreationCounters,
  type Executor,
  type ViewerContext,
} from './lobby-queries.js';

/** Where the creation limits stand for a user (spec §2.1); shared by create and creation-context. */
export interface CreationLimits {
  isNewbie: boolean;
  dailyLimit: number;
  createdInWindow: number;
  /** When the daily limit lifts; null while it isn't reached. */
  retryAt: Date | null;
  upcomingLimit: number;
  upcomingCount: number;
}

export function creationLimits(counters: CreationCounters): CreationLimits {
  const isNewbie = counters.attended < NEWBIE_ATTENDED_MIN;
  const dailyLimit = isNewbie ? NEWBIE_LOBBIES_PER_DAY : LOBBIES_PER_DAY_MAX;
  const created = counters.createdInWindow;
  // The limit lifts when enough of the oldest lobbies leave the window to get below it.
  const freeing = created.length >= dailyLimit ? created[created.length - dailyLimit] : undefined;
  return {
    isNewbie,
    dailyLimit,
    createdInWindow: created.length,
    retryAt: freeing ? new Date(freeing.getTime() + LOBBY_CREATE_WINDOW_HOURS * HOUR_MS) : null,
    upcomingLimit: HOSTED_UPCOMING_MAX,
    upcomingCount: counters.upcoming,
  };
}

/** The first create refusal, in priority order; null lets the user create. */
export function createBlock(viewer: ViewerContext, limits: CreationLimits): CreateBlockReason | null {
  if (!viewer.onboarded) return 'not_onboarded';
  if (viewer.lobbyCreationBlocked) return 'blocked';
  if (limits.retryAt !== null) return 'daily_limit';
  if (limits.upcomingCount >= limits.upcomingLimit) return 'upcoming_limit';
  return null;
}

export interface DetailRequest {
  lobbyId: string;
  viewerId: string;
  now: Date;
  origin?: GeoPoint | null;
  /** Loaded once by the caller when it already has it. */
  viewer?: ViewerContext;
}

@Injectable()
export class LobbiesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async creationContext(userId: string): Promise<CreationContextDto> {
    const now = this.clock.now();
    const viewer = await this.viewer(this.db, userId, now);
    const limits = creationLimits(await loadCreationCounters(this.db, userId, now));
    const reason = createBlock(viewer, limits);
    return {
      canCreate: reason === null,
      reason,
      retryAt: reason === 'daily_limit' ? limits.retryAt!.toISOString() : null,
      isNewbie: limits.isNewbie,
      dailyLimit: limits.dailyLimit,
      createdInWindow: limits.createdInWindow,
      upcomingLimit: limits.upcomingLimit,
      upcomingCount: limits.upcomingCount,
      addressSuggest: Boolean(this.env.DADATA_API_KEY),
    };
  }

  /**
   * Publishes a lobby. A repeat of the same requestId returns the first lobby (created: false),
   * before any limit, so a double tap is never a 429.
   */
  async create(
    userId: string,
    input: CreateLobbyInput,
  ): Promise<{ created: boolean; lobby: LobbyDetailDto }> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      // The user lock serializes this user's creates, so parallel ones can't all pass the limits.
      const [locked] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('no key update');
      if (!locked) throw new UnauthorizedException('Сессия недействительна или истекла');
      const viewer = await this.viewer(tx, userId, now);
      if (!viewer.onboarded) throw apiError('not_onboarded');
      if (viewer.lobbyCreationBlocked) throw apiError('creation_blocked');

      const [existing] = await tx
        .select({ id: lobbies.id })
        .from(lobbies)
        .where(and(eq(lobbies.hostId, userId), eq(lobbies.clientRequestId, input.requestId)));
      if (existing) {
        return {
          created: false,
          lobby: await this.detailFor(tx, { lobbyId: existing.id, viewerId: userId, now, viewer }),
        };
      }

      const limits = creationLimits(await loadCreationCounters(tx, userId, now));
      const block = createBlock(viewer, limits);
      if (block === 'daily_limit') {
        throw apiError('daily_limit', { newbie: limits.isNewbie, retryAt: limits.retryAt!, now });
      }
      if (block === 'upcoming_limit') throw apiError('upcoming_limit');

      const startsAt = truncateToMinute(input.startsAt);
      const startIssue = validateLobbyStart(startsAt, now);
      if (startIssue) throw apiError(startIssue);

      const nearest = nearestStation(input.location);
      const distance = classifyMetroDistance(nearest.distanceM);
      if (distance === 'too_far') throw apiError('place_too_far');

      const [inserted] = await tx
        .insert(lobbies)
        .values({
          hostId: userId,
          category: input.category,
          title: input.title,
          description: input.description,
          startsAt,
          endsAt: new Date(startsAt.getTime() + input.durationMinutes * MINUTE_MS),
          location: { lat: input.location.lat, lng: input.location.lng },
          address: input.address,
          placeHint: placeHint(nearest.station, nearest.line),
          metroStationId: nearest.station.id,
          // The public point is the station's, never derived from anything the client sent.
          publicLocation: { lat: nearest.station.lat, lng: nearest.station.lng },
          farFromMetro: distance === 'far',
          slots: input.slots,
          minKarma: input.minKarma,
          paymentFormat: input.paymentFormat,
          clientRequestId: input.requestId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [lobbies.hostId, lobbies.clientRequestId] })
        .returning({ id: lobbies.id });
      let lobbyId = inserted?.id;
      if (!lobbyId) {
        const [winner] = await tx
          .select({ id: lobbies.id })
          .from(lobbies)
          .where(and(eq(lobbies.hostId, userId), eq(lobbies.clientRequestId, input.requestId)));
        lobbyId = winner!.id;
      }
      return {
        created: inserted !== undefined,
        lobby: await this.detailFor(tx, { lobbyId, viewerId: userId, now, viewer }),
      };
    });
  }

  async detail(viewerId: string, lobbyId: string, origin: GeoPoint | null): Promise<LobbyDetailDto> {
    return this.detailFor(this.db, { lobbyId, viewerId, now: this.clock.now(), origin });
  }

  /**
   * Host cancel, before the start only (spec §5.6). Memberships stay as they are (the Stage 3
   * snapshot of who was in) and no karma moves. A repeat on a cancelled lobby is a 200.
   */
  async cancel(viewerId: string, lobbyId: string, input: CancelLobbyInput): Promise<LobbyDetailDto> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      if (!(await lockLobby(tx, lobbyId))) throw apiError('lobby_not_found');
      const { row, rights, effectiveStatus } = await this.visibleLobby(tx, lobbyId, viewerId, now);
      if (!rights.isHost) throw apiError('not_host');
      if (row.status !== 'cancelled') {
        if (effectiveStatus !== 'open') throw apiError('lobby_started');
        await tx
          .update(lobbies)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            cancelReason: input.reason,
            cancelComment: input.comment,
            updatedAt: now,
          })
          .where(eq(lobbies.id, lobbyId));
      }
      return this.detailFor(tx, { lobbyId, viewerId, now });
    });
  }

  /**
   * The lobby with the viewer's rights, or 404 `lobby_not_found` for a missing or hidden one:
   * both take the same query and give the same body.
   */
  async visibleLobby(db: Executor, lobbyId: string, viewerId: string, now: Date, origin?: GeoPoint | null) {
    const row = await loadLobbyForViewer(db, lobbyId, viewerId, roundOrigin(origin));
    if (!row) throw apiError('lobby_not_found');
    const effectiveStatus = effectiveLobbyStatus(row, now);
    const rights = resolveLobbyAccess({
      viewerId,
      hostId: row.hostId,
      hostShadowBanned: row.hostShadowBanned,
      membership: membershipOf(row),
      effectiveStatus,
    });
    if (!rights.visible) throw apiError('lobby_not_found');
    return { row, rights, effectiveStatus };
  }

  /**
   * The detail as the viewer may see it (404 when hidden). Exact place and members are loaded
   * only when the access rule allows.
   */
  async detailFor(db: Executor, request: DetailRequest): Promise<LobbyDetailDto> {
    const { lobbyId, viewerId, now } = request;
    const { row, rights } = await this.visibleLobby(db, lobbyId, viewerId, now, request.origin);
    const viewer = request.viewer ?? (await this.viewer(db, viewerId, now));

    let access: DetailAccess = { access: 'public' };
    if (rights.canSeeExactPlace) {
      const exact = await loadExactPlace(db, lobbyId);
      if (!exact) throw apiError('lobby_not_found');
      access = { access: rights.isHost ? 'host' : 'member', exactPlace: toExactPlace(exact) };
    }
    const members = rights.canSeeMembers ? (await membersQuery(db, lobbyId)).map(toPerson) : null;
    return toLobbyDetail(row, viewer, now, access, members);
  }

  /** The viewer context of an authenticated user; a deleted user's session is void. */
  async viewer(db: Executor, userId: string, now: Date): Promise<ViewerContext> {
    const viewer = await loadViewerContext(db, userId, now);
    if (!viewer) throw new UnauthorizedException('Сессия недействительна или истекла');
    return viewer;
  }
}
