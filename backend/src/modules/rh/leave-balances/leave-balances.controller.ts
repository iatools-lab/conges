import { Body, Controller, Post } from '@nestjs/common';
import { ImportRhPaidBalancesDto } from './dto/rh-paid-balance-import.dto';
import { RhLeaveBalancesService } from './leave-balances.service';

@Controller('rh/leave-balances')
export class RhLeaveBalancesController {
  constructor(private readonly leaveBalancesService: RhLeaveBalancesService) {}

  @Post('import-paid')
  importPaidBalances(@Body() dto: ImportRhPaidBalancesDto) {
    return this.leaveBalancesService.importPaidBalances(dto);
  }
}
