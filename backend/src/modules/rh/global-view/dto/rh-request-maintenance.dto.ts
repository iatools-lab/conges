import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateRhProcessedRequestDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.5)
  @Max(365)
  days?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class CancelRhProcessedRequestDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
