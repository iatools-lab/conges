import { Module } from '@nestjs/common';
import { PermissionRequestsService } from './permission-requests.service';

@Module({
  providers: [PermissionRequestsService],
  exports: [PermissionRequestsService],
})
export class SharedPermissionsModule {}
