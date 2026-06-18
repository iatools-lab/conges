import { Module } from '@nestjs/common';
import { ManagerRequestsController } from './requests.controller';
import { ManagerRequestsService } from './requests.service';

@Module({
  controllers: [ManagerRequestsController],
  providers: [ManagerRequestsService],
})
export class ManagerRequestsModule {}
