import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { LeaveCategory } from '@prisma/client';

export class CreateRhLeaveTypeDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsEnum(LeaveCategory)
  category!: LeaveCategory;

  @IsNumber()
  @Min(0)
  defaultDays!: number;

  @IsBoolean()
  requiresProof!: boolean;

  @IsBoolean()
  paid!: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateRhLeaveTypeDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(LeaveCategory)
  category?: LeaveCategory;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class InitializeRhBalancesDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  leaveTypeIds?: string[];
}
