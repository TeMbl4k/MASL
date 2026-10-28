import { LINK_TAG_SLUG_MAX, PUBLIC_CODE_LENGTH, START_PARAM_MAX } from './constants.js';

/**
 * Start parameters of t.me/<bot>?startapp=… links (Telegram allows A-Z, a-z, 0-9, _ and -, up
 * to 64 characters). `_` separates the parts, so a part never contains it:
 *   l_<lobby id, 32 hex>[_<ref>]   a lobby, shared by the person with the public code <ref>
 *   p_<code>[_<ref>]                a profile
 *   t_<slug>                        the feed, by an admin's link tag
 * Anything else opens the feed and counts as no link.
 */

export type StartTarget =
  { kind: 'feed' } | { kind: 'lobby'; id: string } | { kind: 'profile'; code: string };

export type StartSource = { kind: 'ref'; code: string } | { kind: 'tag'; slug: string } | null;

export interface StartLink {
  target: StartTarget;
  source: StartSource;
}

const CODE = new RegExp(`^[0-9a-f]{${PUBLIC_CODE_LENGTH}}$`);
const HEX_ID = /^[0-9a-f]{32}$/;
const SLUG = new RegExp(`^[a-z0-9-]{1,${LINK_TAG_SLUG_MAX}}$`);

export const isPublicCode = (value: string): boolean => CODE.test(value);
export const isLinkTagSlug = (value: string): boolean => SLUG.test(value);

const compactId = (id: string) => id.replaceAll('-', '');
const expandId = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** The start parameter of a lobby or profile shared by `ref`, or of a tag. */
export function buildStartParam(link: StartLink): string {
  const ref = link.source?.kind === 'ref' ? `_${link.source.code}` : '';
  switch (link.target.kind) {
    case 'lobby':
      return `l_${compactId(link.target.id)}${ref}`;
    case 'profile':
      return `p_${link.target.code}${ref}`;
    case 'feed':
      return link.source?.kind === 'tag' ? `t_${link.source.slug}` : '';
  }
}

/** The link behind a start parameter; null for one this app never builds. */
export function parseStartParam(raw: string): StartLink | null {
  if (raw.length === 0 || raw.length > START_PARAM_MAX) return null;
  const [kind, value, ref, ...rest] = raw.split('_');
  if (rest.length > 0 || value === undefined) return null;
  if (ref !== undefined && !CODE.test(ref)) return null;
  const source: StartSource = ref === undefined ? null : { kind: 'ref', code: ref };
  if (kind === 'l' && HEX_ID.test(value)) return { target: { kind: 'lobby', id: expandId(value) }, source };
  if (kind === 'p' && CODE.test(value)) return { target: { kind: 'profile', code: value }, source };
  if (kind === 't' && ref === undefined && SLUG.test(value)) {
    return { target: { kind: 'feed' }, source: { kind: 'tag', slug: value } };
  }
  return null;
}

/** A t.me link that opens the bot's main Mini App with `startParam`. */
export function startAppLink(botUsername: string, startParam: string): string {
  const base = `https://t.me/${botUsername}`;
  return startParam ? `${base}?startapp=${startParam}` : `${base}?startapp`;
}
