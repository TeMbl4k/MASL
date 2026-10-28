import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Bot } from 'grammy';
import type { InlineQueryResultArticle } from 'grammy/types';
import { users, type Database } from '@masl/db';
import { buildStartParam, type ShareInput, type ShareResponse, type StartTarget } from '@masl/shared';
import { AppLinks } from '../bot/app-links.js';
import { BOT } from '../bot/bot.provider.js';
import { texts } from '../bot/messages.js';
import { describeTelegramError } from '../bot/telegram-errors.js';
import { CLOCK, type Clock } from '../clock/clock.module.js';
import { DB } from '../db/db.module.js';
import { apiError } from '../errors/api-error.js';
import { LobbiesService } from '../lobbies/lobbies.service.js';
import { findPerson } from './people.service.js';

/**
 * «Поделиться встречей/профилем»: a t.me link with the sharer's public code as the source, and
 * a prepared card for WebApp.shareMessage. Anyone who sees the lobby or profile may share it;
 * the card carries public data only.
 */
@Injectable()
export class ShareService {
  private readonly log = new Logger(ShareService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(AppLinks) private readonly links: AppLinks,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
  ) {}

  async share(viewerId: string, input: ShareInput): Promise<ShareResponse> {
    const now = this.clock.now();
    const [sharer] = await this.db
      .select({ code: users.publicCode, telegramId: users.telegramId })
      .from(users)
      .where(eq(users.id, viewerId));
    if (!sharer) throw apiError('person_not_found');

    let target: StartTarget;
    let card: { text: string; button: string; title: string };
    if (input.kind === 'lobby') {
      // 404 for a lobby the sharer can't see.
      const { row } = await this.lobbies.visibleLobby(this.db, input.id, viewerId, now);
      target = { kind: 'lobby', id: row.id };
      card = {
        title: row.title,
        text: texts.shareLobby({
          title: row.title,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          placeHint: row.placeHint,
          free: Math.max(0, row.slots - row.approvedCount),
          slots: row.slots,
        }),
        button: texts.shareLobbyButton,
      };
    } else {
      const person = await findPerson(this.db, viewerId, input.code);
      if (!person) throw apiError('person_not_found');
      target = { kind: 'profile', code: person.code };
      card = {
        title: person.firstName,
        text: texts.shareProfile(person.firstName, person.karma),
        button: texts.shareProfileButton,
      };
    }

    const link = await this.links.startLink(
      buildStartParam({ target, source: { kind: 'ref', code: sharer.code } }),
    );
    if (link === null) throw apiError('bot_unavailable');
    const article: InlineQueryResultArticle = {
      type: 'article',
      id: `${target.kind}-${now.getTime()}`,
      title: card.title,
      input_message_content: { message_text: card.text, link_preview_options: { is_disabled: true } },
      reply_markup: { inline_keyboard: [[{ text: card.button, url: link }]] },
    };
    try {
      const prepared = await this.bot.api.savePreparedInlineMessage(sharer.telegramId, article, {
        allow_user_chats: true,
        allow_group_chats: true,
        allow_channel_chats: true,
      });
      return { link, preparedMessageId: prepared.id };
    } catch (error) {
      // The app falls back to «Скопировать ссылку».
      this.log.warn(`Бот: карточка для «Поделиться» не создана: ${describeTelegramError(error)}`);
      return { link, preparedMessageId: null };
    }
  }
}
