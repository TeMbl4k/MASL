import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  placeReverseInput,
  placeReverseResponse,
  placeSuggestInput,
  placeSuggestResponse,
  type PlaceReverseInput,
  type PlaceReverseResponse,
  type PlaceSuggestInput,
  type PlaceSuggestResponse,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { PlacesService } from './places.service.js';

/**
 * Always 200: `enabled: false` without a DaData key, `degraded: true` when DaData failed.
 * POST, so the typed address and the exact pin never appear in a URL.
 */
@Controller('places')
@UseGuards(AuthGuard, RateLimitGuard)
export class PlacesController {
  constructor(@Inject(PlacesService) private readonly places: PlacesService) {}

  @Post('suggest')
  @HttpCode(200)
  @RateLimit('placeSuggest', 'placeSuggestDaily')
  @ResponseSchema(placeSuggestResponse)
  suggest(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(placeSuggestInput)) body: PlaceSuggestInput,
  ): Promise<PlaceSuggestResponse> {
    return this.places.suggest(userId, body.q);
  }

  @Post('reverse')
  @HttpCode(200)
  // Shares the daily bucket with suggest: both spend the one service-wide DaData budget.
  @RateLimit('placeReverse', 'placeSuggestDaily')
  @ResponseSchema(placeReverseResponse)
  reverse(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(placeReverseInput)) body: PlaceReverseInput,
  ): Promise<PlaceReverseResponse> {
    return this.places.reverse(userId, { lat: body.lat, lng: body.lng });
  }
}
