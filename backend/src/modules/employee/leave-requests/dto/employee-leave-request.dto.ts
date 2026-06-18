import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FindEmployeeLeaveRequestsQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class CreateEmployeeLeaveRequestDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsString()
  leaveTypeCode!: string;

  @IsOptional()
  @IsString()
  leaveSubtypeCode?: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  draft?: boolean;
}

export class UpdateEmployeeLeaveRequestDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsOptional()
  @IsString()
  leaveTypeCode?: string;

  @IsOptional()
  @IsString()
  leaveSubtypeCode?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
