import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new Map<string, () => void>();
const posted: [string, unknown][] = [];
const env = { version: '9.6', inTelegram: true };

vi.mock('@telegram-apps/bridge', () => ({
  on: (event: string, listener: () => void) => {
    listeners.set(event, listener);
    return () => listeners.delete(event);
  },
  postEvent: (method: string, params: unknown) => void posted.push([method, params]),
}));
vi.mock('@telegram-apps/sdk', () => ({
  retrieveLaunchParams: () => ({ tgWebAppVersion: env.version }),
}));
vi.mock('../session.svelte.js', () => ({
  session: {
    get inTelegram() {
      return env.inTelegram;
    },
  },
}));

const { canRequestChat, requestChat, versionAtLeast } = await import('./request-chat.js');

describe('versionAtLeast', () => {
  it.each([
    ['9.6', true],
    ['9.10', true],
    ['10.0', true],
    ['9.5', false],
    ['8.9', false],
    ['9', false],
    ['x.y', false],
  ])('%s against 9.6 is %s', (version, expected) => {
    expect(versionAtLeast(version, [9, 6])).toBe(expected);
  });
});

describe('requestChat', () => {
  beforeEach(() => {
    listeners.clear();
    posted.length = 0;
    env.version = '9.6';
    env.inTelegram = true;
  });

  it('is offered on Telegram clients from Bot API 9.6 only', () => {
    expect(canRequestChat()).toBe(true);
    env.version = '9.5';
    expect(canRequestChat()).toBe(false);
    env.version = '9.6';
    env.inTelegram = false;
    expect(canRequestChat()).toBe(false);
  });

  it('posts the prepared button and resolves with the picker result', async () => {
    const sent = requestChat('prepared-1');
    expect(posted).toEqual([['web_app_request_chat', { req_id: 'prepared-1' }]]);
    listeners.get('requested_chat_sent')!();
    await expect(sent).resolves.toBe(true);
    expect(listeners.size).toBe(0);

    const cancelled = requestChat('prepared-2');
    listeners.get('requested_chat_failed')!();
    await expect(cancelled).resolves.toBe(false);
  });
});
