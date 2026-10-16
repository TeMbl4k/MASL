import { notInArray, sql } from 'drizzle-orm';
import { INTEREST_SLUGS, INTERESTS } from '@masl/shared';
import type { Database } from './client.js';
import { interests } from './schema.js';

/**
 * Syncs the interests table with the list in @masl/shared: upserts current entries
 * and deletes removed ones (user selections are removed by cascade).
 */
export async function seedInterests(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(interests)
      .values(
        INTERESTS.map((i, index) => ({ slug: i.slug, title: i.title, emoji: i.emoji, sortOrder: index })),
      )
      .onConflictDoUpdate({
        target: interests.slug,
        set: {
          title: sql`excluded.title`,
          emoji: sql`excluded.emoji`,
          sortOrder: sql`excluded.sort_order`,
        },
      });
    await tx.delete(interests).where(notInArray(interests.slug, [...INTEREST_SLUGS]));
  });
}
