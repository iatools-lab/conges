import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateRhLeaveLiabilityDto {
  @IsNumber()
  @Min(0)
  passifInitial!: number;
}

export class ImportRhLeaveLiabilityRowDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  matricule?: string;

  @IsNumber()
  @Min(0)
  passifInitial!: number;
}

export class ImportRhLeaveLiabilitiesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRhLeaveLiabilityRowDto)
  rows!: ImportRhLeaveLiabilityRowDto[];
}
