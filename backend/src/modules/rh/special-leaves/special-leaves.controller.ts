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
import { RhSpecialLeavesService } from './special-leaves.service';
import {
  CreateRhSpecialLeaveDto,
  UpdateRhSpecialLeaveDto,
} from './dto/rh-special-leave.dto';

@Controller('rh/special-leaves')
export class RhSpecialLeavesController {
  constructor(private readonly specialLeavesService: RhSpecialLeavesService) {}

  @Get()
  findAll(@Query('year') year?: string) {
    return this.specialLeavesService.findAll(year);
  }

  @Post()
  create(@Body() dto: CreateRhSpecialLeaveDto) {
    return this.specialLeavesService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRhSpecialLeaveDto) {
    return this.specialLeavesService.update(id, dto);
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.specialLeavesService.cancel(id);
  }
}
