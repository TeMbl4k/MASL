import { Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { qrPrintResponse, tagIdParam, type QrPrintResponse } from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { AdminGuard } from '../moderation/moderator.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { QrService } from './qr.service.js';

@Controller('me/card')
@UseGuards(AuthGuard, RateLimitGuard)
export class CardController {
  constructor(@Inject(QrService) private readonly qr: QrService) {}

  /** «Прислать для печати» of the caller's own QR card. */
  @Post('print')
  @HttpCode(200)
  @RateLimit('qrPrint')
  @ResponseSchema(qrPrintResponse)
  print(@CurrentUserId() userId: string): Promise<QrPrintResponse> {
    return this.qr.printCard(userId);
  }
}

/** A link tag's QR for stickers and flyers: admins only. */
@Controller('admin/tags')
@UseGuards(AuthGuard, AdminGuard, RateLimitGuard)
export class AdminTagQrController {
  constructor(@Inject(QrService) private readonly qr: QrService) {}

  @Post(':id/print')
  @HttpCode(200)
  @RateLimit('qrPrint')
  @ResponseSchema(qrPrintResponse)
  print(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(tagIdParam)) id: number,
  ): Promise<QrPrintResponse> {
    return this.qr.printTag(userId, id);
  }
}
