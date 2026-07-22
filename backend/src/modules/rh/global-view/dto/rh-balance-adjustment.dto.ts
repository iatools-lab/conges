import {
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateRhTakenDaysDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(1000)
  taken!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class UpdateRhTotalDaysDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(2000)
  total!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class UpdateRhPlannedDaysDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsInt()
  @Min(1)
  @Max(365)
  days!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
