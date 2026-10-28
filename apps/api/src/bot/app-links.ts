import { Inject, Injectable } from '@nestjs/common';
import type { Bot } from 'grammy';
import type { InlineKeyboardButton } from 'grammy/types';
import { startAppLink } from '@masl/shared';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { BOT } from './bot.provider.js';

const CACHE_MS = 10 * 60_000;

/** Pages of the Mini App the bot links to. */
export const appPaths = {
  feed: () => '/',
  lobby: (lobbyId: string) => `/lobby/${lobbyId}`,
  applications: (lobbyId: string) => `/lobby/${lobbyId}/manage`,
  attendance: (lobbyId: string) => `/lobby/${lobbyId}/attendance`,
  profile: () => '/profile',
  invites: () => '/my/invites',
  feedback: () => '/feedback',
  adminSupport: () => '/admin/support',
  adminCase: (caseId: string) => `/admin/case/${caseId}`,
};

/**
 * Mini App buttons for private chats. The app's address is the bot's menu button set in
 * @BotFather (no new setting: with a tunnel it changes on every restart, and BotFather is where it
 * already gets updated). Without a web_app menu button messages go without app buttons.
 */
@Injectable()
export class AppLinks {
  private cached: { base: string | null; until: number } | undefined;

  constructor(
    @Inject(BOT) private readonly bot: Bot,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A web_app button opening `path`, or null when the menu button isn't a Mini App. */
  async button(text: string, path: string): Promise<InlineKeyboardButton | null> {
    const base = await this.base();
    return base === null ? null : { text, web_app: { url: new URL(path, base).toString() } };
  }

  /**
   * A t.me link opening the bot's main Mini App with `startParam` (the Main Mini App must be on in
   * @BotFather); null while the bot's username is unknown.
   */
  async startLink(startParam: string): Promise<string | null> {
    try {
      // Fetches getMe once if polling hasn't started yet.
      await this.bot.init();
    } catch {
      return null;
    }
    return startAppLink(this.bot.botInfo.username, startParam);
  }

  private async base(): Promise<string | null> {
    const now = this.clock.now().getTime();
    if (this.cached && this.cached.until > now) return this.cached.base;
    let base: string | null = null;
    try {
      const menu = await this.bot.api.getChatMenuButton();
      base = menu.type === 'web_app' ? menu.web_app.url : null;
    } catch {
      // Not cached: the next message asks again.
      return null;
    }
    this.cached = { base, until: now + CACHE_MS };
    return base;
  }
}
