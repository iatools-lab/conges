import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedRh,
} from '../../../common/auth/authenticated-request';
import { RhSpecialLeavesService } from './special-leaves.service';
import {
  CreateRhSpecialLeaveDto,
  ImportRhSpecialLeavesDto,
  UpdateRhSpecialLeaveDto,
} from './dto/rh-special-leave.dto';

@Controller('rh/special-leaves')
export class RhSpecialLeavesController {
  constructor(private readonly specialLeavesService: RhSpecialLeavesService) {}

  @Get()
  findAll(
    @Query('year') year?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.specialLeavesService.findAll({ year, dateFrom, dateTo });
  }

  @Post()
  create(@Body() dto: CreateRhSpecialLeaveDto) {
    return this.specialLeavesService.create(dto);
  }

  @Post('import')
  importRows(@Body() dto: ImportRhSpecialLeavesDto) {
    return this.specialLeavesService.importRows(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRhSpecialLeaveDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.specialLeavesService.update(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.specialLeavesService.cancel(id);
  }
}
