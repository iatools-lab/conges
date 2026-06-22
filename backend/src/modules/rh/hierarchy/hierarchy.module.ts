import { Module } from '@nestjs/common';
import { RhHierarchyController } from './hierarchy.controller';
import { RhHierarchyService } from './hierarchy.service';

@Module({
  controllers: [RhHierarchyController],
  providers: [RhHierarchyService],
})
export class RhHierarchyModule {}
