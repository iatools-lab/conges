import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EventType } from '@prisma/client';

export class FindEmployeeEventsQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class CreateEmployeeEventDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsEnum(EventType)
  type!: EventType;

  @IsDateString()
  eventDate!: string;

  @IsOptional()
  @IsDateString()
  childBirthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class ReviewEmployeeEventDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @Type(() => Boolean)
  @IsBoolean()
  approved!: boolean;
}
