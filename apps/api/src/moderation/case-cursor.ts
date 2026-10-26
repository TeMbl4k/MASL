import { z } from 'zod';
import { apiError } from '../errors/api-error.js';

/** The keyset position after the last row of a queue page (shadow-banned first, then oldest). */
export interface CaseCursor {
  banned: boolean;
  openedAt: Date;
  id: string;
}

const cursorSchema = z.strictObject({
  b: z.union([z.literal(0), z.literal(1)]),
  t: z.iso.datetime(),
  i: z.uuid(),
});

export function encodeCaseCursor(cursor: CaseCursor): string {
  const payload: z.infer<typeof cursorSchema> = {
    b: cursor.banned ? 1 : 0,
    t: cursor.openedAt.toISOString(),
    i: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** The cursor, or 400 `invalid_cursor` for garbage. */
export function decodeCaseCursor(raw: string): CaseCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw apiError('invalid_cursor');
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) throw apiError('invalid_cursor');
  return { banned: parsed.data.b === 1, openedAt: new Date(parsed.data.t), id: parsed.data.i };
}
