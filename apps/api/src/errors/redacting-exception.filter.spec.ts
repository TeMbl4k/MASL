import { HttpServer, Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { apiErrorDto } from '@masl/shared';
import { RedactingExceptionFilter, redactError } from './redacting-exception.filter.js';

const CANARY_ADDRESS = 'CANARY-ул. Тестовая, 1';
const CANARY_EWKT = 'SRID=4326;POINT(37.552 55.7835)';

function setup(routeUrl: string | undefined = '/api/lobbies/feed') {
  const reply = vi.fn();
  const adapter = { reply, isHeadersSent: () => false, end: vi.fn() } as unknown as HttpServer;
  const filter = new RedactingExceptionFilter(adapter);
  const request = {
    method: 'GET',
    url: '/api/lobbies/feed?lat=55.784&lng=37.553',
    routeOptions: { url: routeUrl },
  };
  const response = {};
  const host = {
    getType: () => 'http',
    getArgByIndex: (i: number) => (i === 0 ? request : response),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  return { filter, host, reply, log, response };
}

/** A driver error the way postgres.js raises it, with the row in `detail`. */
function pgError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`violates something: ${CANARY_ADDRESS}`), {
    name: 'PostgresError',
    code,
    constraint_name: 'lobbies_time_order_chk',
    detail: `Failing row contains (${CANARY_ADDRESS}, ${CANARY_EWKT}).`,
    ...extra,
  });
}

function drizzleError(code: string) {
  return new DrizzleQueryError(
    'insert into "lobbies" ("address", "location") values ($1, $2)',
    [CANARY_ADDRESS, CANARY_EWKT],
    pgError(code),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RedactingExceptionFilter', () => {
  it('logs only the name, pgCode, constraint and route pattern of a DrizzleQueryError', () => {
    const { filter, host, log } = setup();
    filter.catch(drizzleError('23514'), host);

    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('GET /api/lobbies/feed');
    expect(logged).toContain('DrizzleQueryError');
    expect(logged).toContain('pgCode=23514');
    expect(logged).toContain('lobbies_time_order_chk');
    for (const secret of ['CANARY', 'SRID', 'POINT', '37.55', '55.78', 'lat=', 'insert into']) {
      expect(logged).not.toContain(secret);
    }
  });

  it.each([
    ['23505', 409, 'conflict', 'Данные изменились, попробуйте ещё раз'],
    ['23514', 400, 'invalid_data', 'Некорректные данные'],
    ['40P01', 409, 'retry', 'Попробуйте ещё раз'],
    ['40001', 409, 'retry', 'Попробуйте ещё раз'],
    ['22P02', 500, 'internal_error', 'Внутренняя ошибка сервера'],
  ])('maps PostgreSQL %s to %i %s', (pgCode, status, code, message) => {
    const { filter, host, reply, response } = setup();
    filter.catch(drizzleError(pgCode), host);

    expect(reply).toHaveBeenCalledTimes(1);
    const [sentTo, body, sentStatus] = reply.mock.calls[0]!;
    expect(sentTo).toBe(response);
    expect(sentStatus).toBe(status);
    expect(body).toEqual({ statusCode: status, code, message });
    expect(apiErrorDto.safeParse(body).success).toBe(true);
  });

  it('answers any other error with a plain 500 and never logs its message', () => {
    const { filter, host, reply, log } = setup(undefined);
    filter.catch(new TypeError(`cannot read ${CANARY_ADDRESS}`), host);

    expect(reply.mock.calls[0]![1]).toEqual({
      statusCode: 500,
      code: 'internal_error',
      message: 'Внутренняя ошибка сервера',
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('CANARY');
    expect(logged).not.toContain('lat=');
  });

  it("leaves HttpExceptions to Nest's default handling", () => {
    const { filter, host, reply, log } = setup();
    filter.catch(new NotFoundException('Пользователь не найден'), host);

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      { statusCode: 404, message: 'Пользователь не найден', error: 'Not Found' },
      404,
    );
    expect(log).not.toHaveBeenCalled();
  });
});

describe('redactError', () => {
  it('finds the PostgreSQL code through cause and ignores non-PostgreSQL codes', () => {
    expect(redactError(drizzleError('23505'))).toEqual({
      name: 'DrizzleQueryError',
      pgCode: '23505',
      constraint: 'lobbies_time_order_chk',
    });
    for (const code of ['ECONNREFUSED', 'EPIPE', 'EPERM']) {
      expect(redactError(Object.assign(new Error('x'), { code }))).toEqual({
        name: 'Error',
        pgCode: null,
        constraint: null,
      });
      expect(
        redactError(new DrizzleQueryError('select 1', [], Object.assign(new Error('x'), { code }))),
      ).toEqual({
        name: 'DrizzleQueryError',
        pgCode: null,
        constraint: null,
      });
    }
    expect(redactError('boom')).toEqual({ name: 'string', pgCode: null, constraint: null });
  });
});
