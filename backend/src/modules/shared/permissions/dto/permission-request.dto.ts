import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FindEmployeePermissionsQueryDto {
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
}

export class CreateEmployeePermissionDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsDateString()
  permissionDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class UpdateEmployeePermissionDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsOptional()
  @IsDateString()
  permissionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CancelEmployeePermissionDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;
}

export class FindManagerPermissionsQueryDto {
  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsEmail()
  managerEmail?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export const MANAGER_PERMISSION_DECISIONS = ['approve', 'reject'] as const;
export type ManagerPermissionDecision =
  (typeof MANAGER_PERMISSION_DECISIONS)[number];

export class DecideManagerPermissionDto {
  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsEmail()
  managerEmail?: string;

  @IsIn(MANAGER_PERMISSION_DECISIONS)
  decision!: ManagerPermissionDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class FindRhPermissionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  department?: string;
}

export const RH_PERMISSION_DECISIONS = ['approve', 'reject'] as const;
export type RhPermissionDecision = (typeof RH_PERMISSION_DECISIONS)[number];

export class DecideRhPermissionDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsIn(RH_PERMISSION_DECISIONS)
  decision!: RhPermissionDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
