import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LeaveRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateRhSpecialLeaveDto {
  @IsString()
  employeeId!: string;

  @IsOptional()
  @IsString()
  leaveTypeId?: string;

  @IsString()
  eventLabel!: string;

  @IsString()
  startDate!: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(365)
  days?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @IsOptional()
  @IsString()
  proofUrl?: string;

  @IsOptional()
  @IsString()
  proofFilename?: string;
}

export class UpdateRhSpecialLeaveDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  leaveTypeId?: string;

  @IsOptional()
  @IsString()
  eventLabel?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(365)
  days?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @IsOptional()
  @IsString()
  proofUrl?: string;

  @IsOptional()
  @IsString()
  proofFilename?: string;
}

export class ImportRhSpecialLeaveRowDto {
  @IsString()
  matricule!: string;

  @IsString()
  eventLabel!: string;

  @IsOptional()
  @IsString()
  eventDate?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  proofUrl?: string;

  @IsOptional()
  @IsString()
  proofFilename?: string;
}

export class ImportRhSpecialLeavesDto {
  @IsOptional()
  @IsString()
  importedById?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRhSpecialLeaveRowDto)
  rows!: ImportRhSpecialLeaveRowDto[];
}
