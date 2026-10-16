import { UnauthorizedException } from '@nestjs/common';
import { signFields, signInitData } from '../../test/init-data.helper.js';
import type { Env } from '../config/env.js';
import { InitDataService } from './init-data.service.js';

const BOT_TOKEN = '123456789:AAE-test-token_for-masl';
const env = { BOT_TOKEN, INIT_DATA_MAX_AGE_SECONDS: 3600 } as Env;
const service = new InitDataService(env);
const nowSeconds = () => String(Math.floor(Date.now() / 1000));

const ivan = {
  id: 777000111,
  first_name: 'Иван',
  last_name: 'Петров',
  username: 'ivan_p',
  language_code: 'ru',
  allows_write_to_pm: true,
  photo_url: 'https://t.me/i/userpic/320/ivan.jpg',
};

describe('InitDataService', () => {
  it('принимает initData, подписанную токеном бота', () => {
    const authDate = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    expect(service.verify(signInitData(BOT_TOKEN, ivan, { authDate }))).toEqual({
      telegramId: 777000111,
      firstName: 'Иван',
      lastName: 'Петров',
      username: 'ivan_p',
      photoUrl: 'https://t.me/i/userpic/320/ivan.jpg',
      languageCode: 'ru',
      allowsWriteToPm: true,
      authDate,
    });
  });

  it('не требует поля signature и необязательных полей пользователя', () => {
    const raw = signInitData(BOT_TOKEN, { id: 1, first_name: 'A' }, { withSignature: false });
    expect(service.verify(raw)).toMatchObject({
      telegramId: 1,
      lastName: null,
      username: null,
      allowsWriteToPm: false,
    });
  });

  it('отклоняет подделанные данные', () => {
    const raw = signInitData(BOT_TOKEN, ivan);
    const tampered = raw.replace(encodeURIComponent('"id":777000111'), encodeURIComponent('"id":1'));
    expect(tampered).not.toBe(raw);
    expect(() => service.verify(tampered)).toThrow(UnauthorizedException);
  });

  it('отклоняет данные, подписанные другим ботом', () => {
    expect(() => service.verify(signInitData('987654321:other-bot-token', ivan))).toThrow(
      UnauthorizedException,
    );
  });

  it('отклоняет устаревшие данные', () => {
    const old = signInitData(BOT_TOKEN, ivan, { authDate: new Date(Date.now() - 2 * 3600_000) });
    expect(() => service.verify(old)).toThrow(UnauthorizedException);
  });

  it('отклоняет данные без hash и мусор', () => {
    expect(() => service.verify(`user=%7B%7D&auth_date=${nowSeconds()}`)).toThrow(UnauthorizedException);
    expect(() => service.verify('not init data')).toThrow(UnauthorizedException);
  });

  it('отклоняет подписанные данные без пользователя или от бота', () => {
    const noUser = signFields(BOT_TOKEN, { auth_date: nowSeconds(), query_id: 'q' });
    expect(() => service.verify(noUser)).toThrow(UnauthorizedException);

    const bot = signInitData(BOT_TOKEN, { id: 5, first_name: 'Bot', is_bot: true });
    expect(() => service.verify(bot)).toThrow(UnauthorizedException);

    const brokenJson = signFields(BOT_TOKEN, { auth_date: nowSeconds(), user: '{not json' });
    expect(() => service.verify(brokenJson)).toThrow(UnauthorizedException);
  });
});
