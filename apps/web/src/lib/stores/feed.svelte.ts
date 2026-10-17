import type { FeedDayDto, FeedQuery, LobbyCardDto } from '@masl/shared';
import { api, ApiError } from '../api.js';
import { describeError, isAbort } from '../errors.js';
import { session } from '../session.svelte.js';
import { filters } from './filters.svelte.js';
import { lobbyCache } from './lobbies.svelte.js';
import { origin } from './origin.svelte.js';
import { toast } from './toast.svelte.js';

/** Data older than this is refetched when a tab root shows it again (stale-while-revalidate). */
const STALE_MS = 60_000;

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** «Для вас»: the first page plus pages loaded on scroll, for the current filters and origin. */
class FeedStore {
  items = $state<LobbyCardDto[]>([]);
  /** Lobby counts per day for the day strip (first page only). */
  days = $state<FeedDayDto[] | null>(null);
  nextCursor = $state<string | null>(null);
  /** `loading` with items still shown is a background refresh. */
  status = $state<LoadStatus>('idle');
  loadingMore = $state(false);
  error = $state<string | null>(null);
  /** Query of the shown items (filters and origin). */
  key = $state<string | null>(null);
  loadedAt = $state(0);

  #controller: AbortController | null = null;
  #loadingKey: string | null = null;

  constructor() {
    lobbyCache.onCard((card) => this.patchItem(card));
  }

  /** Current query without paging: filters and the rounded origin. */
  get query(): Partial<FeedQuery> {
    return { ...filters.query, ...origin.point };
  }

  /** Loads the first page if the query changed or the data is stale; old items stay visible. */
  async ensure(): Promise<void> {
    await origin.restore();
    const key = JSON.stringify(this.query);
    if (this.status === 'loading' && key === this.#loadingKey) return;
    if (key === this.key && this.status === 'ready' && Date.now() - this.loadedAt < STALE_MS) return;
    await this.#loadFirst();
  }

  /** Reloads the first page now. */
  refresh(): Promise<void> {
    return this.#loadFirst();
  }

  /** Loads the next page; an expired cursor (400) reloads from the top. */
  async loadMore(): Promise<void> {
    const cursor = this.nextCursor;
    if (!cursor || this.loadingMore || this.status === 'loading') return;
    const controller = this.#restart();
    this.loadingMore = true;
    try {
      const page = await session.authorized((token) =>
        api.feed(token, { ...this.query, cursor }, controller.signal),
      );
      const seen = new Set(this.items.map((item) => item.id));
      page.items.forEach((card) => lobbyCache.prime(card));
      this.items = [...this.items, ...page.items.filter((card) => !seen.has(card.id))];
      this.nextCursor = page.nextCursor;
    } catch (error) {
      if (isAbort(error)) return;
      if (error instanceof ApiError && error.status === 400) {
        void this.refresh();
        return;
      }
      toast.error(error);
    } finally {
      if (this.#controller === controller) this.loadingMore = false;
    }
  }

  /** Replaces the card of a lobby that is shown, after its detail changed. */
  patchItem(card: LobbyCardDto): void {
    const index = this.items.findIndex((item) => item.id === card.id);
    if (index >= 0) this.items[index] = card;
  }

  async #loadFirst(): Promise<void> {
    const query = this.query;
    const key = JSON.stringify(query);
    const controller = this.#restart();
    this.#loadingKey = key;
    this.status = 'loading';
    this.loadingMore = false;
    this.error = null;
    try {
      const page = await session.authorized((token) => api.feed(token, query, controller.signal));
      page.items.forEach((card) => lobbyCache.prime(card));
      this.items = page.items;
      this.days = page.days;
      this.nextCursor = page.nextCursor;
      this.key = key;
      this.loadedAt = Date.now();
      this.status = 'ready';
    } catch (error) {
      if (isAbort(error)) return;
      const shown = describeError(error);
      if (shown.kind === 'update') toast.error(error);
      this.error = shown.kind === 'message' ? shown.text : null;
      this.status = 'error';
    }
  }

  /** One request at a time: a new one aborts the previous. */
  #restart(): AbortController {
    this.#controller?.abort();
    this.#controller = new AbortController();
    return this.#controller;
  }
}

export const feed = new FeedStore();
