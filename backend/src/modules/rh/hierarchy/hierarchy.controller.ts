import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  UpdateRhDepartmentHeadDto,
  UpdateRhHierarchyDto,
} from './dto/rh-hierarchy.dto';
import { RhHierarchyService } from './hierarchy.service';

@Controller('rh/hierarchy')
export class RhHierarchyController {
  constructor(private readonly hierarchyService: RhHierarchyService) {}

  @Get('users')
  findUsers() {
    return this.hierarchyService.findUsers();
  }

  @Get('departments')
  findDepartments() {
    return this.hierarchyService.findDepartments();
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateRhHierarchyDto) {
    return this.hierarchyService.updateUserHierarchy(id, dto);
  }

  @Patch('departments/:id')
  updateDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateRhDepartmentHeadDto,
  ) {
    return this.hierarchyService.updateDepartmentHead(id, dto.managerId);
  }
}
