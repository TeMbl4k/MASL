import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@masl/db';
import {
  FEED_DAY_STRIP_DAYS,
  MAP_LOBBIES_MAX,
  MY_LOBBIES_PAST_LIMIT,
  addMoscowDays,
  moscowDayKey,
  moscowDayRange,
  type FeedDayDto,
  type FeedQuery,
  type FeedResponse,
  type MapQuery,
  type MapResponse,
  type MapStationDto,
  type MyLobbiesResponse,
} from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { decodeFeedCursor, encodeFeedCursor, feedQueryKey } from './feed-cursor.js';
import { LobbiesService } from './lobbies.service.js';
import { toLobbyCard, toPublicPlace } from './lobby.mapper.js';
import {
  feedDaysQuery,
  feedPageQuery,
  hostedLobbiesQuery,
  joinedLobbiesQuery,
  loadMyCounts,
  mapLobbiesQuery,
  originOf,
} from './lobby-queries.js';

/** Upcoming lists are small by the hosting and application caps; this only bounds a response. */
const UPCOMING_LIST_MAX = 100;

/** «Для вас», the map and «Мои». */
@Injectable()
export class FeedService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
  ) {}

  async feed(viewerId: string, query: FeedQuery): Promise<FeedResponse> {
    const now = this.clock.now();
    const origin = originOf(query);
    const queryKey = feedQueryKey({
      lat: origin?.lat,
      lng: origin?.lng,
      category: query.category,
      day: query.day,
    });
    const cursor = query.cursor ? decodeFeedCursor(query.cursor, { queryKey, now }) : null;
    const viewer = await this.lobbies.viewer(this.db, viewerId, now);
    // Later pages rank with the first page's inputs; the cards still show the current karma.
    const frozen = cursor ?? { asOf: now, viewerKarma: viewer.karma, interests: viewer.interests };

    const rows = await feedPageQuery(this.db, viewerId, now, {
      filters: { category: query.category, day: query.day },
      ranking: {
        asOf: frozen.asOf,
        origin,
        interests: frozen.interests,
        viewerKarma: frozen.viewerKarma,
      },
      cursor,
      limit: query.limit,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeFeedCursor({
            asOf: frozen.asOf,
            viewerKarma: frozen.viewerKarma,
            interests: frozen.interests,
            queryKey,
            locked: last.locked,
            score: last.score,
            startsAt: last.startsAt,
            id: last.id,
          })
        : null;

    return {
      items: page.map((row) => toLobbyCard(row, viewer, now)),
      nextCursor,
      days: cursor ? null : await this.days(viewerId, now, query.category),
    };
  }

  /** Counts for the day strip: today and the next days in Moscow, zeros included. */
  private async days(viewerId: string, now: Date, category: FeedQuery['category']): Promise<FeedDayDto[]> {
    const today = moscowDayKey(now);
    const dates = Array.from({ length: FEED_DAY_STRIP_DAYS }, (_, i) => addMoscowDays(today, i));
    const to = moscowDayRange(dates.at(-1)!).end;
    const rows = await feedDaysQuery(this.db, viewerId, now, { category, to });
    const counts = new Map(rows.map((r) => [r.day, r.count]));
    return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }));
  }

  /** The earliest MAP_LOBBIES_MAX discoverable lobbies, grouped by station in start order. */
  async map(viewerId: string, query: MapQuery): Promise<MapResponse> {
    const now = this.clock.now();
    const viewer = await this.lobbies.viewer(this.db, viewerId, now);
    const rows = await mapLobbiesQuery(
      this.db,
      viewerId,
      now,
      { category: query.category, day: query.day },
      MAP_LOBBIES_MAX,
    );
    const stations = new Map<string, MapStationDto>();
    for (const row of rows.slice(0, MAP_LOBBIES_MAX)) {
      let station = stations.get(row.metroStationId);
      if (!station) {
        station = { place: toPublicPlace(row), lobbies: [] };
        stations.set(row.metroStationId, station);
      }
      station.lobbies.push(toLobbyCard(row, viewer, now));
    }
    return { stations: [...stations.values()], truncated: rows.length > MAP_LOBBIES_MAX };
  }

  async myLobbies(viewerId: string): Promise<MyLobbiesResponse> {
    const now = this.clock.now();
    const viewer = await this.lobbies.viewer(this.db, viewerId, now);
    const [hostingUpcoming, hostingPast, joinedUpcoming, joinedPast, counts] = await Promise.all([
      hostedLobbiesQuery(this.db, viewerId, now, 'upcoming', UPCOMING_LIST_MAX),
      hostedLobbiesQuery(this.db, viewerId, now, 'past', MY_LOBBIES_PAST_LIMIT),
      joinedLobbiesQuery(this.db, viewerId, now, 'upcoming', UPCOMING_LIST_MAX),
      joinedLobbiesQuery(this.db, viewerId, now, 'past', MY_LOBBIES_PAST_LIMIT),
      loadMyCounts(this.db, viewerId),
    ]);
    const cards = (rows: Parameters<typeof toLobbyCard>[0][]) =>
      rows.map((row) => toLobbyCard(row, viewer, now));
    return {
      hosting: { upcoming: cards(hostingUpcoming), past: cards(hostingPast) },
      joined: { upcoming: cards(joinedUpcoming), past: cards(joinedPast) },
      counts,
    };
  }
}
