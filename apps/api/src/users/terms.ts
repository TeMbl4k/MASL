import { TERMS_VERSION } from '@masl/shared';

/** The user accepted the current user agreement; an older version counts as not accepted. */
export function termsAccepted(user: { termsVersion: number | null }): boolean {
  return user.termsVersion === TERMS_VERSION;
}
