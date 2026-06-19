import {
  IsArray,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImportRhLeaveHistoryRowDto {
  @IsString()
  @MaxLength(80)
  reference!: string;

  @IsString()
  @MaxLength(80)
  matricule!: string;

  @IsString()
  @MaxLength(80)
  type!: string;

  @IsString()
  @MaxLength(40)
  category!: string;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsNumber()
  @Min(0.5)
  days!: number;
}

export class ImportRhLeaveHistoryDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRhLeaveHistoryRowDto)
  rows!: ImportRhLeaveHistoryRowDto[];
}
