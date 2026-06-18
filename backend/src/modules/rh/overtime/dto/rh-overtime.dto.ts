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

export class FindRhOvertimeQueryDto {
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

export const RH_OVERTIME_DECISIONS = ['approve', 'reject'] as const;

export type RhOvertimeDecision = (typeof RH_OVERTIME_DECISIONS)[number];

export class DecideRhOvertimeDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsIn(RH_OVERTIME_DECISIONS)
  decision!: RhOvertimeDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
