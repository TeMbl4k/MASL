import { Global, Module } from '@nestjs/common';

/** Source of the current time; services take `now` from it once per call. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

@Global()
@Module({
  providers: [{ provide: CLOCK, useFactory: (): Clock => ({ now: () => new Date() }) }],
  exports: [CLOCK],
})
export class ClockModule {}
