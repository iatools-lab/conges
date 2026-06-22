import {
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RoleType } from '@prisma/client';

class UpdateStepDto {
  @IsOptional()
  @IsInt()
  order?: number;

  @IsEnum(RoleType)
  validator!: RoleType;

  @IsOptional()
  @IsInt()
  slaHours?: number;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateStepDto)
  steps?: UpdateStepDto[];
}
