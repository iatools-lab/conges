import { IsDateString, IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateHolidayDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  recurring?: boolean;
}
