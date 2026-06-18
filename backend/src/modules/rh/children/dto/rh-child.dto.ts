import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export enum RhChildSexeDto {
  M = 'M',
  F = 'F',
}

export class CreateRhChildDto {
  @IsString()
  @IsNotEmpty()
  parentId: string;

  @IsString()
  @IsNotEmpty()
  nom: string;

  @IsString()
  @IsNotEmpty()
  prenom: string;

  @IsDateString()
  dateNaissance: string;

  @IsEnum(RhChildSexeDto)
  sexe: RhChildSexeDto;
}

export class UpdateRhChildDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  parentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nom?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  prenom?: string;

  @IsOptional()
  @IsDateString()
  dateNaissance?: string;

  @IsOptional()
  @IsEnum(RhChildSexeDto)
  sexe?: RhChildSexeDto;
}
