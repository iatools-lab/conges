import { Module } from '@nestjs/common';
import { SharedPermissionsModule } from '../../shared/permissions/permissions.module';
import { RhPermissionsController } from './permissions.controller';

@Module({
  imports: [SharedPermissionsModule],
  controllers: [RhPermissionsController],
})
export class RhPermissionsModule {}
