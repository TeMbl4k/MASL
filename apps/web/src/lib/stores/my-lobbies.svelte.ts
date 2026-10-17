import type { LobbyBucketDto, MyLobbiesResponse } from '@masl/shared';
import { api } from '../api.js';
import { describeError } from '../errors.js';
import { session } from '../session.svelte.js';
import type { LoadStatus } from './feed.svelte.js';
import { lobbyCache } from './lobbies.svelte.js';
import { toast } from './toast.svelte.js';

/** Data older than this is refetched when a tab root shows it again (stale-while-revalidate). */
const STALE_MS = 60_000;

const emptyBucket = (): LobbyBucketDto => ({ upcoming: [], past: [] });

/** «Мои события»: lobbies the viewer hosts and joined, plus the profile counts. */
class MyLobbies {
  hosting = $state<LobbyBucketDto>(emptyBucket());
  joined = $state<LobbyBucketDto>(emptyBucket());
  counts = $state<MyLobbiesResponse['counts']>({ hosted: 0, joined: 0 });
  status = $state<LoadStatus>('idle');
  error = $state<string | null>(null);
  loadedAt = $state(0);

  /** New applications waiting in open hosted lobbies (the dot on the «Мои» tab). */
  pendingTotal = $derived(
    this.hosting.upcoming.reduce(
      (sum, lobby) => sum + (lobby.status === 'open' ? (lobby.pendingCount ?? 0) : 0),
      0,
    ),
  );

  #inflight: Promise<void> | null = null;
  #stale = true;

  constructor() {
    lobbyCache.onMutation(() => this.invalidate());
  }

  /** Loads if never loaded, invalidated or older than a minute. */
  ensure(): Promise<void> {
    if (!this.#stale && this.status === 'ready' && Date.now() - this.loadedAt < STALE_MS) {
      return Promise.resolve();
    }
    return this.#load();
  }

  /** Marks the data stale after a mutation; reloads in the background once it was shown. */
  invalidate(): void {
    this.#stale = true;
    if (this.status !== 'idle') void this.#load();
  }

  #load(): Promise<void> {
    // A load that started before the latest invalidate is followed by another one.
    if (this.#inflight) return this.#inflight.then(() => (this.#stale ? this.#load() : undefined));
    this.#stale = false;
    this.status = this.status === 'ready' ? 'ready' : 'loading';
    this.error = null;
    this.#inflight = session
      .authorized((token) => api.myLobbies(token))
      .then((response) => {
        for (const bucket of [response.hosting, response.joined]) {
          [...bucket.upcoming, ...bucket.past].forEach((card) => lobbyCache.prime(card));
        }
        this.hosting = response.hosting;
        this.joined = response.joined;
        this.counts = response.counts;
        this.loadedAt = Date.now();
        this.status = 'ready';
      })
      .catch((error: unknown) => {
        const shown = describeError(error);
        if (shown.kind === 'update') toast.error(error);
        this.error = shown.kind === 'message' ? shown.text : null;
        if (this.status !== 'ready') this.status = 'error';
      })
      .finally(() => {
        this.#inflight = null;
      });
    return this.#inflight;
  }
}

export const myLobbies = new MyLobbies();
