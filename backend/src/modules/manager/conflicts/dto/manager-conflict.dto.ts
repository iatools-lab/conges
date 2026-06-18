import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const MANAGER_CONFLICT_ACTIONS = [
  'resolve',
  'ignore',
  'postpone',
] as const;
export type ManagerConflictAction = (typeof MANAGER_CONFLICT_ACTIONS)[number];

export class FindManagerConflictsQueryDto {
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

export class UpdateManagerConflictDto {
  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsEmail()
  managerEmail?: string;

  @IsIn(MANAGER_CONFLICT_ACTIONS)
  action!: ManagerConflictAction;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  reportPerson?: string;

  @IsOptional()
  @IsString()
  reportDate?: string;
}
