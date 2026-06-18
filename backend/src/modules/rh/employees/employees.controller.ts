import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateRhEmployeeDto,
  ImportRhEmployeesDto,
  UpdateRhEmployeeDto,
} from './dto/rh-employee.dto';
import { RhEmployeesService } from './employees.service';

@Controller('rh/employees')
export class RhEmployeesController {
  constructor(private readonly employeesService: RhEmployeesService) {}

  @Get()
  findAll() {
    return this.employeesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateRhEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Post('import')
  importEmployees(@Body() dto: ImportRhEmployeesDto) {
    return this.employeesService.importEmployees(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRhEmployeeDto) {
    return this.employeesService.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.employeesService.deactivate(id);
  }
}
