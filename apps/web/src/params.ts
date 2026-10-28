import { isPublicCode } from '@masl/shared';
import { defineParams } from '@sveltejs/kit/params';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route param matchers. `/lobby/[id=uuid]`: anything else falls through to the 404 page. */
export const params = defineParams({
  uuid: (param) => (UUID.test(param) ? param : undefined),
  /** `/u/[code=code]`: a person's public code. */
  code: (param) => (isPublicCode(param) ? param : undefined),
});
