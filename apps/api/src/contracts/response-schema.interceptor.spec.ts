import 'reflect-metadata';
import { HttpException, Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { apiErrorDto, lobbyCardDto, type LobbyCardDto } from '@masl/shared';
import { firstValueFrom, of } from 'rxjs';
import { RESPONSE_SCHEMA, ResponseSchema } from './response-schema.decorator.js';
import { ResponseSchemaInterceptor } from './response-schema.interceptor.js';

const CANARY_ADDRESS = 'CANARY-ул. Тестовая, 1';

const card: LobbyCardDto = {
  id: '6f1c9a52-1d1e-4f5a-9a49-3a8f0d2b7c11',
  category: 'sport',
  title: 'Падел 2×2',
  startsAt: '2026-10-18T16:30:00.000Z',
  endsAt: '2026-10-18T18:30:00.000Z',
  status: 'open',
  slots: 3,
  approvedCount: 0,
  pendingCount: null,
  minKarma: 40,
  paymentFormat: 'split',
  place: {
    hint: 'м. Динамо',
    stationId: '2-dinamo',
    lineName: 'Замоскворецкая',
    lineColor: '#4FB04F',
    point: { lat: 55.7896, lng: 37.5582 },
    farFromMetro: false,
  },
  distanceM: 1200,
  host: { firstName: 'Анна', photoUrl: null, karma: 50 },
  viewer: { isHost: false, membershipStatus: null, applyBlock: null },
};

class Handlers {
  @ResponseSchema(lobbyCardDto)
  card(): void {}

  plain(): void {}
}

function setup(handler: keyof Handlers, data: unknown) {
  const header = vi.fn();
  const request = {
    method: 'GET',
    url: '/api/lobbies/6f1c9a52-1d1e-4f5a-9a49-3a8f0d2b7c11?lat=55.784&lng=37.553',
    routeOptions: { url: '/api/lobbies/:id' },
  };
  const context = {
    getHandler: () => Handlers.prototype[handler],
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ header }) }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(data) };
  const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  const run = () => firstValueFrom(new ResponseSchemaInterceptor(new Reflector()).intercept(context, next));
  return { run, header, log };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResponseSchemaInterceptor', () => {
  it('returns the parsed response and marks it private, no-store', async () => {
    const { run, header, log } = setup('card', card);
    await expect(run()).resolves.toEqual(card);
    expect(header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(log).not.toHaveBeenCalled();
  });

  it('fails closed: an exact address on a public card becomes a 500 that logs paths, not values', async () => {
    const leaky = { ...card, address: CANARY_ADDRESS, place: { ...card.place, exact: { lat: 55.7835 } } };
    const { run, header, log } = setup('card', leaky);

    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(500);
    expect(exception.getResponse()).toEqual({
      statusCode: 500,
      code: 'internal_error',
      message: 'Внутренняя ошибка сервера',
    });
    expect(apiErrorDto.safeParse(exception.getResponse()).success).toBe(true);
    expect(JSON.stringify(exception.getResponse())).not.toContain('CANARY');
    expect(header).not.toHaveBeenCalled();

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    const [prefix, paths] = line.split(': ') as [string, string];
    expect(prefix).toBe('Ответ GET /api/lobbies/:id не прошёл схему');
    expect(paths.split(', ').sort()).toEqual(['address', 'place.exact']);
    for (const value of ['CANARY', '55.78', 'lat=', '6f1c9a52']) {
      expect(line).not.toContain(value);
    }
  });

  it('reports a wrong value by its path only', async () => {
    const { run, log } = setup('card', { ...card, title: 42 });
    await expect(run()).rejects.toBeInstanceOf(HttpException);
    expect(String(log.mock.calls[0]![0])).toBe('Ответ GET /api/lobbies/:id не прошёл схему: title');
  });

  it('passes handlers without @ResponseSchema through untouched', async () => {
    const raw = { anything: CANARY_ADDRESS };
    const { run, header } = setup('plain', raw);
    await expect(run()).resolves.toBe(raw);
    expect(header).not.toHaveBeenCalled();
    expect(Reflect.getMetadata(RESPONSE_SCHEMA, Handlers.prototype.plain)).toBeUndefined();
  });
});
