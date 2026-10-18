import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  attendanceInput,
  attendanceResponse,
  checkInInput,
  idParam,
  lobbyDetailDto,
  type AttendanceInput,
  type AttendanceResponse,
  type CheckInInput,
  type LobbyDetailDto,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { AttendanceService } from './attendance.service.js';

@Controller('lobbies/:id')
@UseGuards(AuthGuard, RateLimitGuard)
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly attendance: AttendanceService) {}

  /** «Я на месте» of an approved member, by the device position; the position is not stored. */
  @Post('check-in')
  @HttpCode(200)
  @RateLimit('checkIn')
  @ResponseSchema(lobbyDetailDto)
  checkIn(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(checkInInput)) body: CheckInInput,
  ): Promise<LobbyDetailDto> {
    return this.attendance.checkIn(userId, id, body);
  }

  /** The host's list of who came. */
  @Get('attendance')
  @RateLimit('lobbyRead')
  @ResponseSchema(attendanceResponse)
  view(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<AttendanceResponse> {
    return this.attendance.view(userId, id);
  }

  /** The host saves who was absent; once per lobby. */
  @Put('attendance')
  @RateLimit('attendanceWrite')
  @ResponseSchema(attendanceResponse)
  save(
    @CurrentUserId() userId: string,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(attendanceInput)) body: AttendanceInput,
  ): Promise<AttendanceResponse> {
    return this.attendance.save(userId, id, body.absentApplicationIds);
  }
}
