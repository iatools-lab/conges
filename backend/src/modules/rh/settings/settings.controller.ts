import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RhSettingsService } from './settings.service';
import {
  CreateRhLeaveTypeDto,
  InitializeRhBalancesDto,
  UpdateRhLeaveTypeDto,
} from './dto/rh-settings.dto';

@Controller('rh/settings')
export class RhSettingsController {
  constructor(private readonly settingsService: RhSettingsService) {}

  @Get()
  findSettings(@Query('year') year?: string) {
    return this.settingsService.findSettings(year);
  }

  @Post('leave-types/defaults')
  createDefaultLeaveTypes() {
    return this.settingsService.createDefaultLeaveTypes();
  }

  @Post('leave-types')
  createLeaveType(@Body() dto: CreateRhLeaveTypeDto) {
    return this.settingsService.createLeaveType(dto);
  }

  @Patch('leave-types/:id')
  updateLeaveType(@Param('id') id: string, @Body() dto: UpdateRhLeaveTypeDto) {
    return this.settingsService.updateLeaveType(id, dto);
  }

  @Delete('leave-types/:id')
  deleteLeaveType(@Param('id') id: string) {
    return this.settingsService.deleteLeaveType(id);
  }

  @Post('balances/initialize')
  initializeBalances(@Body() dto: InitializeRhBalancesDto) {
    return this.settingsService.initializeBalances(dto);
  }
}
