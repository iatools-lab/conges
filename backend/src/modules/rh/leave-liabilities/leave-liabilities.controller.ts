import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RhLeaveLiabilitiesService } from './leave-liabilities.service';
import {
  ImportRhLeaveLiabilitiesDto,
  UpdateRhLeaveLiabilityDto,
} from './dto/rh-leave-liability.dto';

@Controller('rh/leave-liabilities')
export class RhLeaveLiabilitiesController {
  constructor(
    private readonly leaveLiabilitiesService: RhLeaveLiabilitiesService,
  ) {}

  @Get()
  findAll(@Query('year') year?: string) {
    return this.leaveLiabilitiesService.findAll(year);
  }

  @Patch(':userId')
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateRhLeaveLiabilityDto,
  ) {
    return this.leaveLiabilitiesService.update(userId, dto);
  }

  @Post('import')
  importRows(@Body() dto: ImportRhLeaveLiabilitiesDto) {
    return this.leaveLiabilitiesService.importRows(dto);
  }
}
