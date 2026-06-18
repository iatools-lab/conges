import { Module } from '@nestjs/common';
import { RhAuditController } from './audit.controller';

@Module({
  controllers: [RhAuditController],
})
export class RhAuditModule {}
