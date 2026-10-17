import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  placeReverseQuery,
  placeReverseResponse,
  placeSuggestQuery,
  placeSuggestResponse,
  type PlaceReverseQuery,
  type PlaceReverseResponse,
  type PlaceSuggestQuery,
  type PlaceSuggestResponse,
} from '@masl/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ResponseSchema } from '../contracts/response-schema.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthGuard, CurrentUserId } from '../session/auth.guard.js';
import { PlacesService } from './places.service.js';

/** Always 200: `enabled: false` without a DaData key, `degraded: true` when DaData failed. */
@Controller('places')
@UseGuards(AuthGuard, RateLimitGuard)
export class PlacesController {
  constructor(@Inject(PlacesService) private readonly places: PlacesService) {}

  @Get('suggest')
  @RateLimit('placeSuggest', 'placeSuggestDaily')
  @ResponseSchema(placeSuggestResponse)
  suggest(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(placeSuggestQuery)) query: PlaceSuggestQuery,
  ): Promise<PlaceSuggestResponse> {
    return this.places.suggest(userId, query.q);
  }

  @Get('reverse')
  // Shares the daily bucket with suggest: both spend the one service-wide DaData budget.
  @RateLimit('placeReverse', 'placeSuggestDaily')
  @ResponseSchema(placeReverseResponse)
  reverse(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(placeReverseQuery)) query: PlaceReverseQuery,
  ): Promise<PlaceReverseResponse> {
    return this.places.reverse(userId, { lat: query.lat, lng: query.lng });
  }
}
