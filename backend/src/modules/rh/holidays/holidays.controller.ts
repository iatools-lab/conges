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
import { AdminHolidaysService } from '../../admin/holidays/holidays.service';
import { CreateHolidayDto } from '../../admin/holidays/dto/create-holiday.dto';
import { UpdateHolidayDto } from '../../admin/holidays/dto/update-holiday.dto';

@Controller('rh/holidays')
export class RhHolidaysController {
  constructor(private readonly service: AdminHolidaysService) {}

  @Get()
  findMany(@Query('year') year?: string, @Query('country') country?: string) {
    const y = year ? Number(year) : undefined;
    return this.service.findMany(y, country);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateHolidayDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateHolidayDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
