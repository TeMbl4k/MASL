import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { idParam, reportInput, reportResponse, type ReportInput, type ReportResponse } from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { ReportsService } from './reports.service.js';

@Controller('lobbies/:id/reports')
@UseGuards(AuthGuard, RateLimitGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /** «Пожаловаться»: 200 on the first report and on a repeat; the host is never told. */
  @Post()
  @HttpCode(200)
  @RateLimit('reportWrite')
  @ResponseSchema(reportResponse)
  report(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(reportInput)) body: ReportInput,
  ): Promise<ReportResponse> {
    return this.reports.report(userId, id, body);
  }
}
