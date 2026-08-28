import { Module } from '@nestjs/common';
import { SharedPermissionsModule } from '../../shared/permissions/permissions.module';
import { EmployeePermissionsController } from './permissions.controller';

@Module({
  imports: [SharedPermissionsModule],
  controllers: [EmployeePermissionsController],
})
export class EmployeePermissionsModule {}
