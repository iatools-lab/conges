import { Module } from '@nestjs/common';
import { ManagerHistoryController } from './history.controller';
import { ManagerHistoryService } from './history.service';

@Module({
  controllers: [ManagerHistoryController],
  providers: [ManagerHistoryService],
})
export class ManagerHistoryModule {}
