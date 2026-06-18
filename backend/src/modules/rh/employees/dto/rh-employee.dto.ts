import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export enum RhEmployeeRoleDto {
  EMPLOYEE = 'employee',
  MANAGER = 'manager',
  RH = 'rh',
}

export enum RhEmployeeStatusDto {
  ACTIVE = 'active',
  LEAVE = 'leave',
  INACTIVE = 'inactive',
}

export enum RhEmployeeSexeDto {
  M = 'M',
  F = 'F',
}

export class CreateRhEmployeeDto {
  @IsString()
  @IsNotEmpty()
  matricule: string;

  @IsString()
  @IsNotEmpty()
  nom: string;

  @IsString()
  @IsNotEmpty()
  prenom: string;

  @IsDateString()
  dateNaissance: string;

  @IsEnum(RhEmployeeSexeDto)
  sexe: RhEmployeeSexeDto;

  @IsDateString()
  embauche: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  passifInitial?: number;

  @IsOptional()
  @IsString()
  n1Matricule?: string;

  @IsOptional()
  @IsString()
  n2Matricule?: string;

  @IsOptional()
  @IsString()
  n3Matricule?: string;

  @IsString()
  @IsNotEmpty()
  dept: string;

  @IsString()
  @IsNotEmpty()
  poste: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsEnum(RhEmployeeRoleDto)
  role?: RhEmployeeRoleDto;

  @IsOptional()
  @IsArray()
  @IsEnum(RhEmployeeRoleDto, { each: true })
  roles?: RhEmployeeRoleDto[];
}

export class UpdateRhEmployeeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  matricule?: string;

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
  @IsEnum(RhEmployeeSexeDto)
  sexe?: RhEmployeeSexeDto;

  @IsOptional()
  @IsDateString()
  embauche?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  passifInitial?: number;

  @IsOptional()
  @IsString()
  n1Matricule?: string;

  @IsOptional()
  @IsString()
  n2Matricule?: string;

  @IsOptional()
  @IsString()
  n3Matricule?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  dept?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  poste?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(RhEmployeeRoleDto)
  role?: RhEmployeeRoleDto;

  @IsOptional()
  @IsArray()
  @IsEnum(RhEmployeeRoleDto, { each: true })
  roles?: RhEmployeeRoleDto[];

  @IsOptional()
  @IsEnum(RhEmployeeStatusDto)
  status?: RhEmployeeStatusDto;
}

export class ImportRhEmployeesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRhEmployeeDto)
  employees: CreateRhEmployeeDto[];
}
