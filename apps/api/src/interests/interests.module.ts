import { Controller, Get, Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { interests, seedInterests, type Database } from '@masl/db';
import type { InterestDto } from '@masl/shared';
import { DB } from '../db/db.module.js';

@Injectable()
class InterestsService implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The interests catalog lives in code (@masl/shared) and is synced to the DB on startup. */
  async onApplicationBootstrap(): Promise<void> {
    await seedInterests(this.db);
  }

  list(): Promise<InterestDto[]> {
    return this.db
      .select({ slug: interests.slug, title: interests.title, emoji: interests.emoji })
      .from(interests)
      .orderBy(asc(interests.sortOrder));
  }
}

@Controller('interests')
class InterestsController {
  constructor(@Inject(InterestsService) private readonly service: InterestsService) {}

  @Get()
  list(): Promise<InterestDto[]> {
    return this.service.list();
  }
}

@Module({
  controllers: [InterestsController],
  providers: [InterestsService],
})
export class InterestsModule {}
