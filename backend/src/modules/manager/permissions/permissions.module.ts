import { Module } from '@nestjs/common';
import { SharedPermissionsModule } from '../../shared/permissions/permissions.module';
import { ManagerPermissionsController } from './permissions.controller';

@Module({
  imports: [SharedPermissionsModule],
  controllers: [ManagerPermissionsController],
})
export class ManagerPermissionsModule {}
