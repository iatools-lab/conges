import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FindManagerOvertimeQueryDto {
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

export const MANAGER_OVERTIME_DECISIONS = ['approve', 'reject'] as const;

export type ManagerOvertimeDecision =
  (typeof MANAGER_OVERTIME_DECISIONS)[number];

export class DecideManagerOvertimeDto {
  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsEmail()
  managerEmail?: string;

  @IsIn(MANAGER_OVERTIME_DECISIONS)
  decision!: ManagerOvertimeDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
