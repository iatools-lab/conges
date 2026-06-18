import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AdminSettingsService } from './settings.service';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private service: AdminSettingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  upsert(@Body() dto: UpsertSettingDto) {
    return this.service.upsert(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
