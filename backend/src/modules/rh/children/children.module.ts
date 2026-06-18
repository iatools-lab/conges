import { Module } from '@nestjs/common';
import { RhChildrenController } from './children.controller';
import { RhChildrenService } from './children.service';

@Module({
  controllers: [RhChildrenController],
  providers: [RhChildrenService],
})
export class RhChildrenModule {}
