import 'reflect-metadata';
import { HttpException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMITS, apiErrorDto } from '@masl/shared';
import type { Clock } from '../clock/clock.module.js';
import { FixedWindowStore } from './fixed-window.store.js';
import { RateLimit } from './rate-limit.decorator.js';
import { RateLimitGuard } from './rate-limit.guard.js';

class Handlers {
  @RateLimit('lobbyWrite')
  write(): void {}

  @RateLimit('placeSuggest', 'placeSuggestDaily')
  suggest(): void {}

  @RateLimit('lobbyRead')
  read(): void {}

  free(): void {}
}

const START = Date.parse('2026-10-17T12:00:00.000Z');

function setup(maxKeys?: number) {
  let nowMs = START;
  const clock: Clock = { now: () => new Date(nowMs) };
  const store = new FixedWindowStore(maxKeys);
  const guard = new RateLimitGuard(new Reflector(), store, clock);
  const headers: Record<string, string>[] = [];
  const call = (handler: keyof Handlers, userId: string | undefined) => {
    const header = (name: string, value: string) => headers.push({ [name]: value });
    const context = {
      getHandler: () => Handlers.prototype[handler],
      switchToHttp: () => ({ getRequest: () => ({ userId }), getResponse: () => ({ header }) }),
    } as unknown as ExecutionContext;
    try {
      return guard.canActivate(context);
    } catch (error) {
      return error;
    }
  };
  return { call, store, headers, advance: (ms: number) => (nowMs += ms) };
}

const { limit: WRITE_LIMIT, windowSeconds: WRITE_WINDOW } = RATE_LIMITS.lobbyWrite;

describe('RateLimitGuard', () => {
  it('limits each bucket per user in a fixed window and answers 429 with Retry-After', () => {
    const { call, headers, advance } = setup();
    for (let i = 0; i < WRITE_LIMIT; i++) {
      expect(call('write', 'user-a')).toBe(true);
    }
    advance(20_000);
    const refused = call('write', 'user-a');
    expect(refused).toBeInstanceOf(HttpException);
    const exception = refused as HttpException;
    expect(exception.getStatus()).toBe(429);
    expect(exception.getResponse()).toEqual({
      statusCode: 429,
      code: 'rate_limited',
      message: 'Слишком много запросов. Подождите немного',
    });
    expect(apiErrorDto.safeParse(exception.getResponse()).success).toBe(true);
    expect(headers).toEqual([{ 'Retry-After': String(WRITE_WINDOW - 20) }]);

    // Other users and other buckets have their own windows.
    expect(call('write', 'user-b')).toBe(true);
    expect(call('read', 'user-a')).toBe(true);

    // The window is fixed from its first hit, not sliding.
    advance(WRITE_WINDOW * 1000 - 20_000);
    expect(call('write', 'user-a')).toBe(true);
  });

  it('rounds Retry-After up to whole seconds', () => {
    const { call, headers, advance } = setup();
    for (let i = 0; i < WRITE_LIMIT; i++) call('write', 'user-a');
    advance(WRITE_WINDOW * 1000 - 1500);
    expect(call('write', 'user-a')).toBeInstanceOf(HttpException);
    expect(headers.at(-1)).toEqual({ 'Retry-After': '2' });
  });

  it('stacked buckets: all must have room, and a refusal counts against none', () => {
    const { call, store, headers, advance } = setup();
    const perMinute = RATE_LIMITS.placeSuggest.limit;
    const perDay = RATE_LIMITS.placeSuggestDaily.limit;
    const minutes = Math.floor(perDay / perMinute);
    for (let m = 0; m < minutes; m++) {
      for (let i = 0; i < perMinute; i++) {
        expect(call('suggest', 'user-a')).toBe(true);
      }
      // The per-minute bucket is full: refused, and the daily count doesn't move.
      expect(call('suggest', 'user-a')).toBeInstanceOf(HttpException);
      advance(RATE_LIMITS.placeSuggest.windowSeconds * 1000);
    }
    expect(minutes * perMinute).toBe(perDay);
    // The minute window is fresh, but the daily one is full.
    const refused = call('suggest', 'user-a');
    expect(refused).toBeInstanceOf(HttpException);
    const elapsed = minutes * RATE_LIMITS.placeSuggest.windowSeconds;
    expect(headers.at(-1)).toEqual({
      'Retry-After': String(RATE_LIMITS.placeSuggestDaily.windowSeconds - elapsed),
    });
    expect(store.size).toBe(1);
  });

  it('lets handlers without @RateLimit through and needs AuthGuard before it', () => {
    const { call, store } = setup();
    for (let i = 0; i < 1000; i++) {
      expect(call('free', 'user-a')).toBe(true);
    }
    expect(store.size).toBe(0);
    expect(call('free', undefined)).toBe(true);
    expect(call('write', undefined)).toBeInstanceOf(UnauthorizedException);
  });
});

describe('FixedWindowStore', () => {
  const hit = (key: string, limit = 2, windowMs = 1000) => [{ key, limit, windowMs }];

  it('sweep drops only expired windows, clear drops all', () => {
    const store = new FixedWindowStore();
    store.take(hit('a', 2, 1000), 0);
    store.take(hit('b', 2, 5000), 0);
    store.sweep(1000);
    expect(store.size).toBe(1);
    expect(store.take(hit('b', 1, 5000), 1000)).toEqual({ allowed: false, retryAfterMs: 4000 });

    store.clear();
    expect(store.size).toBe(0);
    expect(store.take(hit('b', 1, 5000), 1000)).toEqual({ allowed: true });
  });

  it('caps the number of keys: sweeps first, then forgets the oldest live window', () => {
    const store = new FixedWindowStore(3);
    store.take(hit('expired', 1, 10), 0);
    store.take(hit('a', 1), 0);
    store.take(hit('b', 1), 0);
    // Full; the expired window goes first.
    store.take(hit('c', 1), 100);
    expect(store.size).toBe(3);
    expect(store.take(hit('a', 1), 100).allowed).toBe(false);

    // Full of live windows; the oldest (a) is forgotten.
    store.take(hit('d', 1), 200);
    expect(store.size).toBe(3);
    expect(store.take(hit('a', 1), 200).allowed).toBe(true);
    expect(store.take(hit('c', 1), 200).allowed).toBe(false);
  });
});
