import { parseStartParam } from '@masl/shared';
import { retrieveLaunchParams } from '@telegram-apps/sdk';
import { session } from '../session.svelte.js';

/** The page a t.me/<bot>?startapp=… link opens; null for the feed or a link this app never builds. */
export function startParamPath(raw: string): string | null {
  const target = parseStartParam(raw)?.target;
  switch (target?.kind) {
    case 'lobby':
      return `/lobby/${target.id}`;
    case 'profile':
      return `/u/${target.code}`;
    default:
      return null;
  }
}

/** The start parameter this Mini App was launched with; null outside Telegram or without one. */
export function launchStartParam(): string | null {
  if (!session.inTelegram) return null;
  try {
    return retrieveLaunchParams().tgWebAppStartParam || null;
  } catch {
    return null;
  }
}

/**
 * Whether this page load is a reload: the SDK keeps launch params in sessionStorage, so a reload
 * would otherwise open the link's page again.
 */
export function isReload(): boolean {
  return performance
    .getEntriesByType('navigation')
    .some((entry) => (entry as PerformanceNavigationTiming).type === 'reload');
}
