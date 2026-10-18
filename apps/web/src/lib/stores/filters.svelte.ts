import type { LobbyCategory } from '@masl/shared';

/** Category and day filters, shared by the feed and the map. Null means «all». */
class Filters {
  category = $state<LobbyCategory | null>(null);
  /** Moscow day 'YYYY-MM-DD'. */
  day = $state<string | null>(null);

  /** The filters as API query parameters. */
  get query(): { category?: LobbyCategory; day?: string } {
    return { category: this.category ?? undefined, day: this.day ?? undefined };
  }

  reset(): void {
    this.category = null;
    this.day = null;
  }
}

export const filters = new Filters();
