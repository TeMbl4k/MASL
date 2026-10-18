import type {
  CancelApplicationResponse,
  CancelLobbyInput,
  CancelLobbyResponse,
  LobbyCardDto,
  LobbyDetailDto,
} from '@masl/shared';
import { SvelteMap } from 'svelte/reactivity';
import { api, ApiError } from '../api.js';
import { cardOf, detailMatchesCard } from '../lobby-card.js';
import { session } from '../session.svelte.js';
import { origin } from './origin.svelte.js';

export interface LobbyEntry {
  card: LobbyCardDto;
  /** The last loaded detail, replaced wholesale on every load or mutation, never merged. */
  detail?: LobbyDetailDto;
}

/**
 * Lobby cache shared by the feed, the map, «Мои» and the lobby page. A detail is always replaced
 * as a whole, so `exactPlace` disappears as soon as the API stops sending it.
 */
class LobbyCache {
  #entries = new SvelteMap<string, LobbyEntry>();
  /** Bumped when a mutation starts and ends; a load that saw another value is stale. */
  #versions = new Map<string, number>();
  #cardListeners = new Set<(card: LobbyCardDto) => void>();
  #mutationListeners = new Set<() => void>();

  get(id: string): LobbyEntry | undefined {
    return this.#entries.get(id);
  }

  /**
   * Feed, map and «Мои» cards: updates the card part, and drops the cached detail when the card
   * shows a different status or viewer role, since the detail may carry an exact place.
   */
  prime(card: LobbyCardDto): void {
    const detail = this.#entries.get(card.id)?.detail;
    this.#entries.set(card.id, {
      card,
      detail: detail && detailMatchesCard(detail, card) ? detail : undefined,
    });
  }

  /** Called with the fresh card after every detail load or mutation (the feed patches its item). */
  onCard(listener: (card: LobbyCardDto) => void): () => void {
    this.#cardListeners.add(listener);
    return () => this.#cardListeners.delete(listener);
  }

  /** Called after every mutation («Мои» refetches). */
  onMutation(listener: () => void): () => void {
    this.#mutationListeners.add(listener);
    return () => this.#mutationListeners.delete(listener);
  }

  /**
   * Loads the detail with the viewer's origin for the distance. A 404 drops the entry. A response
   * that started before a mutation on the same lobby is dropped, so a poll can't undo it.
   */
  async load(id: string, signal?: AbortSignal): Promise<LobbyDetailDto> {
    const version = this.#version(id);
    try {
      const detail = await session.authorized((token) => api.lobby(token, id, origin.point, signal));
      const current = this.#entries.get(id)?.detail;
      if (this.#version(id) !== version && current) return current;
      this.#store(detail);
      return detail;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.#entries.delete(id);
      throw error;
    }
  }

  /** Puts a detail returned by another call (the wizard's create) into the cache. */
  setDetail(detail: LobbyDetailDto): void {
    this.#store(detail);
    this.#mutated();
  }

  apply(id: string): Promise<LobbyDetailDto> {
    return this.#mutate(id, async () => {
      const detail = await session.authorized((token) => api.apply(token, id));
      this.#store(detail);
      return detail;
    });
  }

  /** Cancels the viewer's application or place; refreshes the karma after a late cancel. */
  cancelApplication(id: string): Promise<CancelApplicationResponse> {
    return this.#mutate(id, async () => {
      const response = await session.authorized((token) => api.cancelApplication(token, id));
      this.#store(response.lobby);
      if (response.karmaDelta !== 0) void this.#refreshUser();
      return response;
    });
  }

  /** Cancels the host's lobby; a late cancel of a full lobby costs karma and blocks creation. */
  cancelLobby(id: string, input: CancelLobbyInput): Promise<CancelLobbyResponse> {
    return this.#mutate(id, async () => {
      const response = await session.authorized((token) => api.cancelLobby(token, id, input));
      this.#store(response.lobby);
      if (response.karmaDelta !== 0) void this.#refreshUser();
      return response;
    });
  }

  #version(id: string): number {
    return this.#versions.get(id) ?? 0;
  }

  #bump(id: string): void {
    this.#versions.set(id, this.#version(id) + 1);
  }

  async #mutate<T>(id: string, run: () => Promise<T>): Promise<T> {
    this.#bump(id);
    try {
      return await run();
    } finally {
      this.#bump(id);
      // A refused mutation changes nothing, but «Мои» refetches anyway: the refusal may be news.
      this.#mutated();
    }
  }

  #store(detail: LobbyDetailDto): void {
    const card = cardOf(detail);
    this.#entries.set(detail.id, { card, detail });
    for (const listener of this.#cardListeners) listener(card);
  }

  #mutated(): void {
    for (const listener of this.#mutationListeners) listener();
  }

  async #refreshUser(): Promise<void> {
    try {
      session.setUser(await session.authorized((token) => api.me(token)));
    } catch {
      // The header shows the old karma until the next refresh.
    }
  }
}

export const lobbyCache = new LobbyCache();
