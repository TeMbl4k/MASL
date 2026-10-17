import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { telegramAuthInput, type AuthResponse, type TelegramAuthInput } from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TokenService } from '../session/token.service.js';
import { UsersService } from '../users/users.service.js';
import { InitDataService } from './init-data.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(InitDataService) private readonly initData: InitDataService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /**
   * Sign-in via initData: the Mini App sends the Telegram.WebApp.initData string,
   * the API verifies the signature, creates or updates the user and issues a session.
   */
  @Post('telegram')
  @HttpCode(200)
  async telegram(
    @Body(new ZodValidationPipe(telegramAuthInput)) body: TelegramAuthInput,
  ): Promise<AuthResponse> {
    const identity = this.initData.verify(body.initData);
    const user = await this.users.upsertFromTelegram(identity);
    const { token, expiresAt } = await this.tokens.issue(user.id);
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: await this.users.getMe(user.id),
    };
  }
}
