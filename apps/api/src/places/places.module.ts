import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { UsersModule } from '../users/users.module.js';
import { DADATA_FETCH, DadataClient, type FetchFn } from './dadata.client.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

/** Resolved per call, so a test can stub the global fetch at the network boundary. */
const globalFetch: FetchFn = (url, init) => globalThis.fetch(url, init);

/** Address suggestions and reverse geocoding through DaData. */
@Module({
  imports: [SessionModule, UsersModule],
  controllers: [PlacesController],
  providers: [{ provide: DADATA_FETCH, useValue: globalFetch }, DadataClient, PlacesService],
})
export class PlacesModule implements OnApplicationBootstrap {
  constructor(@Inject(DadataClient) private readonly dadata: DadataClient) {}

  /** One line for the operator (docs/deploy-vps.md promises it); never the key itself. */
  onApplicationBootstrap(): void {
    new Logger('Places').log(
      this.dadata.enabled
        ? 'Подсказки адресов DaData включены'
        : 'Подсказки адресов DaData выключены: DADATA_API_KEY не задан',
    );
  }
}
