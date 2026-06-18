import { IsEmail, IsString, IsOptional } from 'class-validator';
import { RoleType } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  nom?: string;

  @IsOptional()
  @IsString()
  prenom?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsString()
  poste?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  managerId?: string | null;

  @IsOptional()
  @IsString()
  n1Id?: string | null;

  @IsOptional()
  @IsString()
  n2Id?: string | null;

  @IsOptional()
  @IsString()
  n3Id?: string | null;

  @IsOptional()
  roles?: Array<{ role: RoleType; scope?: string }>;
}
