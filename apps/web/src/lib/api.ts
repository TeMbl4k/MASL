import {
  adminCancelLobbyResponse,
  adminCaseDto,
  adminCasesResponse,
  adminUserCardDto,
  adminUserSearchResponse,
  appealStateDto,
  attendanceResponse,
  cancelApplicationResponse,
  chatPrepareResponse,
  creationContextDto,
  feedResponse,
  hostApplicationsResponse,
  karmaEventsResponse,
  cancelLobbyResponse,
  lobbyDetailDto,
  mapResponse,
  meDto,
  myLobbiesResponse,
  placeReverseResponse,
  placeSuggestResponse,
  reportResponse,
  type AdminCasesQuery,
  type AuthResponse,
  type CancelLobbyInput,
  type ChatPrepareInput,
  type CheckInInput,
  type CreateLobbyInput,
  type FeedQuery,
  type GeoPointDto,
  type InterestDto,
  type MapQuery,
  type MeDto,
  type OnboardingInput,
  type ReportInput,
  type ResolveCaseRequest,
  type UserActionRequest,
} from '@masl/shared';

/**
 * API base URL. Defaults to `/api` on the same origin: in production the API serves
 * the Mini App itself, in development Vite proxies /api to localhost:3000. VITE_API_URL
 * is only needed when the API lives on another domain.
 */
const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.token) {
    headers.set('Authorization', `Bearer ${init.token}`);
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // body isn't JSON, keep the generic message
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

/**
 * A response that doesn't match the shared schema: the app is older than the API (a deploy
 * while the Mini App stayed open). The UI asks for a reload instead of guessing.
 */
export class ResponseShapeError extends Error {
  constructor() {
    super('Ответ сервера не совпал с ожидаемым');
  }
}

/** The part of a zod schema `parsed` needs (zod itself is a dependency of @masl/shared only). */
interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

function parsed<T>(schema: ResponseSchema<T>, response: Promise<unknown>): Promise<T> {
  return response.then((data) => {
    const result = schema.safeParse(data);
    if (!result.success) throw new ResponseShapeError();
    return result.data;
  });
}

/** Query string from the defined values, with the leading `?`; empty when nothing is set. */
function qs(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

const lobbyPath = (id: string) => `/lobbies/${encodeURIComponent(id)}`;
const casePath = (id: string) => `/admin/cases/${encodeURIComponent(id)}`;
const adminUserPath = (id: string) => `/admin/users/${encodeURIComponent(id)}`;
const applicationPath = (id: string, applicationId: string) =>
  `${lobbyPath(id)}/applications/${encodeURIComponent(applicationId)}`;

export const api = {
  loginWithTelegram: (initData: string) =>
    request<AuthResponse>('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) }),
  me: (token: string) => request<MeDto>('/me', { token }),
  interests: () => request<InterestDto[]>('/interests'),
  acceptTerms: (token: string, version: number) =>
    parsed(meDto, request('/me/terms', { method: 'PUT', token, body: JSON.stringify({ version }) })),
  completeOnboarding: (token: string, input: OnboardingInput) =>
    request<MeDto>('/me/onboarding', { method: 'PUT', token, body: JSON.stringify(input) }),

  // Lobbies, applications, profile and places: every response is parsed with its shared schema.
  feed: (token: string, query: Partial<FeedQuery>, signal?: AbortSignal) =>
    parsed(feedResponse, request(`/lobbies/feed${qs(query)}`, { token, signal })),
  map: (token: string, query: Partial<MapQuery>, signal?: AbortSignal) =>
    parsed(mapResponse, request(`/lobbies/map${qs(query)}`, { token, signal })),
  creationContext: (token: string) =>
    parsed(creationContextDto, request('/lobbies/creation-context', { token })),
  createLobby: (token: string, input: CreateLobbyInput) =>
    parsed(lobbyDetailDto, request('/lobbies', { method: 'POST', token, body: JSON.stringify(input) })),
  lobby: (token: string, id: string, origin?: GeoPointDto | null, signal?: AbortSignal) =>
    parsed(
      lobbyDetailDto,
      request(`${lobbyPath(id)}${qs({ lat: origin?.lat, lng: origin?.lng })}`, { token, signal }),
    ),
  cancelLobby: (token: string, id: string, input: CancelLobbyInput) =>
    parsed(
      cancelLobbyResponse,
      request(`${lobbyPath(id)}/cancel`, { method: 'POST', token, body: JSON.stringify(input) }),
    ),
  // Mutations without data still send `{}`: a tunnel or proxy may forward an empty body as chunked,
  // and Fastify answers 415 to a body with no Content-Type.
  apply: (token: string, id: string) =>
    parsed(lobbyDetailDto, request(`${lobbyPath(id)}/applications`, { method: 'POST', token, body: '{}' })),
  cancelApplication: (token: string, id: string) =>
    parsed(
      cancelApplicationResponse,
      request(`${lobbyPath(id)}/applications/me`, { method: 'DELETE', token, body: '{}' }),
    ),
  applications: (token: string, id: string, signal?: AbortSignal) =>
    parsed(hostApplicationsResponse, request(`${lobbyPath(id)}/applications`, { token, signal })),
  approve: (token: string, id: string, applicationId: string) =>
    parsed(
      hostApplicationsResponse,
      request(`${applicationPath(id, applicationId)}/approve`, { method: 'POST', token, body: '{}' }),
    ),
  reject: (token: string, id: string, applicationId: string) =>
    parsed(
      hostApplicationsResponse,
      request(`${applicationPath(id, applicationId)}/reject`, { method: 'POST', token, body: '{}' }),
    ),
  prepareChat: (token: string, id: string, input: ChatPrepareInput) =>
    parsed(
      chatPrepareResponse,
      request(`${lobbyPath(id)}/chat/prepare`, { method: 'POST', token, body: JSON.stringify(input) }),
    ),
  // POST: the device position stays out of URLs and access logs.
  checkIn: (token: string, id: string, point: CheckInInput) =>
    parsed(
      lobbyDetailDto,
      request(`${lobbyPath(id)}/check-in`, {
        method: 'POST',
        token,
        body: JSON.stringify({ lat: point.lat, lng: point.lng }),
      }),
    ),
  attendance: (token: string, id: string, signal?: AbortSignal) =>
    parsed(attendanceResponse, request(`${lobbyPath(id)}/attendance`, { token, signal })),
  saveAttendance: (token: string, id: string, absentApplicationIds: string[]) =>
    parsed(
      attendanceResponse,
      request(`${lobbyPath(id)}/attendance`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ absentApplicationIds }),
      }),
    ),
  myLobbies: (token: string) => parsed(myLobbiesResponse, request('/me/lobbies', { token })),
  karmaEvents: (token: string) => parsed(karmaEventsResponse, request('/me/karma-events', { token })),
  updateInterests: (token: string, interests: string[]) =>
    parsed(meDto, request('/me/interests', { method: 'PUT', token, body: JSON.stringify({ interests }) })),
  report: (token: string, id: string, input: ReportInput) =>
    parsed(
      reportResponse,
      request(`${lobbyPath(id)}/reports`, { method: 'POST', token, body: JSON.stringify(input) }),
    ),
  appeal: (token: string) => parsed(appealStateDto, request('/me/appeal', { token })),
  submitAppeal: (token: string, text: string) =>
    parsed(appealStateDto, request('/me/appeals', { method: 'POST', token, body: JSON.stringify({ text }) })),

  // Moderation: moderators and admins only (the API checks the role on every call).
  adminCases: (token: string, query: Partial<AdminCasesQuery>, signal?: AbortSignal) =>
    parsed(adminCasesResponse, request(`/admin/cases${qs(query)}`, { token, signal })),
  adminCase: (token: string, id: string, signal?: AbortSignal) =>
    parsed(adminCaseDto, request(casePath(id), { token, signal })),
  resolveCase: (token: string, id: string, input: ResolveCaseRequest) =>
    parsed(
      adminCaseDto,
      request(`${casePath(id)}/resolve`, { method: 'POST', token, body: JSON.stringify(input) }),
    ),
  adminCancelLobby: (token: string, id: string, comment: string | null) =>
    parsed(
      adminCancelLobbyResponse,
      request(`/admin${lobbyPath(id)}/cancel`, { method: 'POST', token, body: JSON.stringify({ comment }) }),
    ),
  adminUsers: (token: string, q: string, signal?: AbortSignal) =>
    parsed(adminUserSearchResponse, request(`/admin/users${qs({ q })}`, { token, signal })),
  adminUser: (token: string, id: string, signal?: AbortSignal) =>
    parsed(adminUserCardDto, request(adminUserPath(id), { token, signal })),
  userAction: (token: string, id: string, input: UserActionRequest) =>
    parsed(
      adminUserCardDto,
      request(`${adminUserPath(id)}/actions`, { method: 'POST', token, body: JSON.stringify(input) }),
    ),

  // POST: the typed address and the exact pin stay out of URLs and so out of access logs.
  placeSuggest: (token: string, q: string, signal?: AbortSignal) =>
    parsed(
      placeSuggestResponse,
      request('/places/suggest', { method: 'POST', token, signal, body: JSON.stringify({ q }) }),
    ),
  placeReverse: (token: string, point: GeoPointDto, signal?: AbortSignal) =>
    parsed(
      placeReverseResponse,
      request('/places/reverse', {
        method: 'POST',
        token,
        signal,
        body: JSON.stringify({ lat: point.lat, lng: point.lng }),
      }),
    ),
};
