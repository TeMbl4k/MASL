import { Inject, Injectable } from '@nestjs/common';
import type { GeoPointDto, PlaceReverseResponse, PlaceSuggestResponse } from '@masl/shared';
import { UsersService } from '../users/users.service.js';
import { DadataClient, type DadataResult } from './dadata.client.js';

const flags = (result: DadataResult<unknown>) => ({
  enabled: result.status !== 'disabled',
  degraded: result.status === 'degraded',
});

/** Address help for the creation wizard; only onboarded users may spend the DaData quota. */
@Injectable()
export class PlacesService {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(DadataClient) private readonly dadata: DadataClient,
  ) {}

  async suggest(userId: string, query: string): Promise<PlaceSuggestResponse> {
    await this.users.requireOnboarded(userId);
    const result = await this.dadata.suggest(query);
    return { ...flags(result), items: result.status === 'ok' ? result.value : [] };
  }

  async reverse(userId: string, point: GeoPointDto): Promise<PlaceReverseResponse> {
    await this.users.requireOnboarded(userId);
    const result = await this.dadata.reverse(point);
    return { ...flags(result), address: result.status === 'ok' ? result.value : null };
  }
}
