import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ImportRhPaidBalanceRowDto {
  @IsString()
  matricule!: string;

  @IsNumber()
  @Min(0)
  paidBalance!: number;
}

export class ImportRhPaidBalancesDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  importedById?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRhPaidBalanceRowDto)
  rows!: ImportRhPaidBalanceRowDto[];
}
