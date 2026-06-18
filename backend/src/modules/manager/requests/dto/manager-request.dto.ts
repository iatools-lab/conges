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

export const MANAGER_REQUEST_DECISIONS = [
  'approve',
  'reject',
  'review',
] as const;

export type ManagerRequestDecision = (typeof MANAGER_REQUEST_DECISIONS)[number];

export class FindManagerRequestsQueryDto {
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

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class DecideManagerRequestDto {
  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsEmail()
  managerEmail?: string;

  @IsIn(MANAGER_REQUEST_DECISIONS)
  decision!: ManagerRequestDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
