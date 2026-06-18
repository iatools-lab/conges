import { Module } from '@nestjs/common';
import { RhGlobalViewController } from './global-view.controller';
import { RhGlobalViewService } from './global-view.service';

@Module({
  controllers: [RhGlobalViewController],
  providers: [RhGlobalViewService],
})
export class RhGlobalViewModule {}
