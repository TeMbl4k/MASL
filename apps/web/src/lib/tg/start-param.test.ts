import { describe, expect, it, vi } from 'vitest';

const env = { inTelegram: true, startParam: undefined as string | undefined, throws: false };

vi.mock('@telegram-apps/sdk', () => ({
  retrieveLaunchParams: () => {
    if (env.throws) throw new Error('no launch params');
    return { tgWebAppStartParam: env.startParam };
  },
}));
vi.mock('../session.svelte.js', () => ({
  session: {
    get inTelegram() {
      return env.inTelegram;
    },
  },
}));

const { launchStartParam, startParamPath } = await import('./start-param.js');

const LOBBY_ID = '0b9e4c1a-5d2f-4e8a-9c3b-7f6a1d2e3c4b';
const CODE = 'a1b2c3d4e5f6';

describe('startParamPath', () => {
  it('opens the shared lobby or profile, with or without the sharer', () => {
    const hex = LOBBY_ID.replaceAll('-', '');
    expect(startParamPath(`l_${hex}`)).toBe(`/lobby/${LOBBY_ID}`);
    expect(startParamPath(`l_${hex}_${CODE}`)).toBe(`/lobby/${LOBBY_ID}`);
    expect(startParamPath(`p_${CODE}_${CODE}`)).toBe(`/u/${CODE}`);
  });

  it('stays on the feed for tags and links the app never builds', () => {
    for (const raw of ['t_channel', '', 'l_zzz', `p_${CODE}_x`, 'x'.repeat(65), `l_${LOBBY_ID}`]) {
      expect(startParamPath(raw)).toBeNull();
    }
  });
});

describe('launchStartParam', () => {
  it('reads the launch parameter only inside Telegram', () => {
    env.startParam = 't_channel';
    expect(launchStartParam()).toBe('t_channel');
    env.startParam = '';
    expect(launchStartParam()).toBeNull();
    env.startParam = 't_channel';
    env.throws = true;
    expect(launchStartParam()).toBeNull();
    env.throws = false;
    env.inTelegram = false;
    expect(launchStartParam()).toBeNull();
  });
});
