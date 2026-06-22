import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class UpdateRhLeaveLiabilityDto {
  @IsNumber()
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
  passifInitial!: number;
}

export class ImportRhLeaveLiabilitiesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRhLeaveLiabilityRowDto)
  rows!: ImportRhLeaveLiabilityRowDto[];
}
