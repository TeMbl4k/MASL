import type { ApplicantDto, HostApplicationsResponse } from '@masl/shared';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { api } from '../api.js';
import { session } from '../session.svelte.js';
import { lobbyCache } from './lobbies.svelte.js';
import { myLobbies } from './my-lobbies.svelte.js';

type Decision = 'approved' | 'rejected';

/**
 * The host's applications per lobby. Decisions are optimistic and roll back on a refusal; a load
 * that started before the latest decision on the same lobby is dropped, so a stale poll can't
 * undo an optimistic approve.
 */
class ApplicationsStore {
  #lists = new SvelteMap<string, HostApplicationsResponse>();
  /** Bumped when a decision starts and ends. */
  #versions = new Map<string, number>();
  /** Application ids with a decision in flight. */
  #deciding = new SvelteSet<string>();

  get(lobbyId: string): HostApplicationsResponse | undefined {
    return this.#lists.get(lobbyId);
  }

  isDeciding(applicationId: string): boolean {
    return this.#deciding.has(applicationId);
  }

  async load(lobbyId: string, signal?: AbortSignal): Promise<void> {
    const version = this.#version(lobbyId);
    const list = await session.authorized((token) => api.applications(token, lobbyId, signal));
    if (this.#version(lobbyId) !== version) return;
    this.#set(lobbyId, list);
  }

  approve(lobbyId: string, applicationId: string): Promise<void> {
    return this.#decide(lobbyId, applicationId, 'approved');
  }

  reject(lobbyId: string, applicationId: string): Promise<void> {
    return this.#decide(lobbyId, applicationId, 'rejected');
  }

  async #decide(lobbyId: string, applicationId: string, decision: Decision): Promise<void> {
    const before = this.#lists.get(lobbyId);
    const applicant = before?.pending.find((a) => a.applicationId === applicationId);
    if (!before || !applicant || this.#deciding.has(applicationId)) return;
    this.#bump(lobbyId);
    this.#deciding.add(applicationId);
    this.#lists.set(lobbyId, optimistic(before, applicant, decision));
    try {
      const list = await session.authorized((token) =>
        decision === 'approved'
          ? api.approve(token, lobbyId, applicationId)
          : api.reject(token, lobbyId, applicationId),
      );
      this.#set(lobbyId, list);
    } catch (error) {
      this.#lists.set(lobbyId, before);
      throw error;
    } finally {
      this.#deciding.delete(applicationId);
      this.#bump(lobbyId);
      // The «Мои» dot counts pending applications.
      myLobbies.invalidate();
    }
  }

  #set(lobbyId: string, list: HostApplicationsResponse): void {
    this.#lists.set(lobbyId, list);
    lobbyCache.prime(list.lobby);
  }

  #version(lobbyId: string): number {
    return this.#versions.get(lobbyId) ?? 0;
  }

  #bump(lobbyId: string): void {
    this.#versions.set(lobbyId, this.#version(lobbyId) + 1);
  }
}

/** The list as it will be once the decision goes through. */
function optimistic(
  list: HostApplicationsResponse,
  applicant: ApplicantDto,
  decision: Decision,
): HostApplicationsResponse {
  const decided: ApplicantDto = { ...applicant, status: decision, decidedAt: new Date().toISOString() };
  const pendingCount = list.lobby.pendingCount === null ? null : Math.max(0, list.lobby.pendingCount - 1);
  return {
    lobby: {
      ...list.lobby,
      pendingCount,
      approvedCount: list.lobby.approvedCount + (decision === 'approved' ? 1 : 0),
    },
    pending: list.pending.filter((a) => a.applicationId !== applicant.applicationId),
    approved: decision === 'approved' ? [...list.approved, decided] : list.approved,
    rejected: decision === 'rejected' ? [decided, ...list.rejected] : list.rejected,
  };
}

export const applications = new ApplicationsStore();
