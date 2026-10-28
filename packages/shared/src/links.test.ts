import { describe, expect, it } from 'vitest';
import { START_PARAM_MAX } from './constants.js';
import { buildStartParam, parseStartParam, startAppLink, type StartLink } from './links.js';
import { inviteCandidatesQuery, linkTagInput, sendInvitesInput, shareInput } from './schemas.js';

const LOBBY_ID = '3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b';
const CODE = 'a1b2c3d4e5f6';
const REF = '0123456789ab';

describe('start parameters', () => {
  const links: StartLink[] = [
    { target: { kind: 'lobby', id: LOBBY_ID }, source: { kind: 'ref', code: REF } },
    { target: { kind: 'lobby', id: LOBBY_ID }, source: null },
    { target: { kind: 'profile', code: CODE }, source: { kind: 'ref', code: REF } },
    { target: { kind: 'feed' }, source: { kind: 'tag', slug: 'sticker-hyperborea' } },
  ];

  it.each(links)('round-trips $target.kind with $source', (link) => {
    const param = buildStartParam(link);
    expect(param.length).toBeLessThanOrEqual(START_PARAM_MAX);
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseStartParam(param)).toEqual(link);
  });

  it('fits the longest lobby link into Telegram’s limit', () => {
    expect(buildStartParam(links[0]!)).toBe(`l_${LOBBY_ID.replaceAll('-', '')}_${REF}`);
  });

  it.each([
    '',
    'x',
    'l_123',
    `l_${LOBBY_ID}`,
    `l_${LOBBY_ID.replaceAll('-', '')}_short`,
    `l_${LOBBY_ID.replaceAll('-', '')}_${REF}_extra`,
    `p_${CODE.toUpperCase()}`,
    't_UPPER',
    't_has_underscore',
    `t_${'a'.repeat(33)}`,
    `t_ok_${REF}`,
    'x'.repeat(START_PARAM_MAX + 1),
  ])('rejects %j', (raw) => {
    expect(parseStartParam(raw)).toBeNull();
  });

  it('builds t.me links to the main Mini App', () => {
    expect(startAppLink('masl_bot', 't_channel')).toBe('https://t.me/masl_bot?startapp=t_channel');
  });
});

describe('stage 6 inputs', () => {
  it('needs a query of 3+ characters unless the companions filter is on', () => {
    expect(inviteCandidatesQuery.safeParse({ q: 'ан' }).success).toBe(false);
    expect(inviteCandidatesQuery.safeParse({}).success).toBe(false);
    expect(inviteCandidatesQuery.parse({ q: ' анн ' })).toEqual({ filter: 'all', q: 'анн' });
    expect(inviteCandidatesQuery.parse({ filter: 'companions', q: '' })).toEqual({ filter: 'companions' });
  });

  it('takes up to 10 distinct public codes per invite request', () => {
    const codes = Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(12, '0'));
    expect(sendInvitesInput.safeParse({ codes: codes.slice(0, 10) }).success).toBe(true);
    expect(sendInvitesInput.safeParse({ codes }).success).toBe(false);
    expect(sendInvitesInput.safeParse({ codes: [CODE, CODE] }).success).toBe(false);
    expect(sendInvitesInput.safeParse({ codes: [LOBBY_ID] }).success).toBe(false);
  });

  it('lower-cases a tag and allows only Latin letters, digits and hyphens', () => {
    expect(linkTagInput.parse({ slug: ' Flyers-MSU ', title: 'Листовки' }).slug).toBe('flyers-msu');
    expect(linkTagInput.safeParse({ slug: 'листовки', title: 'x' }).success).toBe(false);
    expect(linkTagInput.safeParse({ slug: 'a_b', title: 'x' }).success).toBe(false);
  });

  it('shares a lobby by id or a profile by code only', () => {
    expect(shareInput.safeParse({ kind: 'lobby', id: LOBBY_ID }).success).toBe(true);
    expect(shareInput.safeParse({ kind: 'profile', code: CODE }).success).toBe(true);
    expect(shareInput.safeParse({ kind: 'profile', code: LOBBY_ID }).success).toBe(false);
  });
});
