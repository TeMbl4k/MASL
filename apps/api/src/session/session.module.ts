import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { TokenService } from './token.service.js';

@Module({
  providers: [TokenService, AuthGuard],
  exports: [TokenService, AuthGuard],
})
export class SessionModule {}
