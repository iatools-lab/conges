import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RhChildrenService } from './children.service';
import { CreateRhChildDto, UpdateRhChildDto } from './dto/rh-child.dto';

@Controller('rh/children')
export class RhChildrenController {
  constructor(private readonly childrenService: RhChildrenService) {}

  @Get()
  findAll() {
    return this.childrenService.findAll();
  }

  @Post()
  create(@Body() dto: CreateRhChildDto) {
    return this.childrenService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRhChildDto) {
    return this.childrenService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.childrenService.remove(id);
  }
}
