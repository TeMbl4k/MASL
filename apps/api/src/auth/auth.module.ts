import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { InitDataService } from './init-data.service.js';

@Module({
  imports: [SessionModule, UsersModule],
  controllers: [AuthController],
  providers: [InitDataService],
})
export class AuthModule {}
