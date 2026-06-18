import { IsEmail, IsString, IsOptional, IsEnum } from 'class-validator';
import { RoleType } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  matricule!: string;

  @IsString()
  nom!: string;

  @IsString()
  prenom!: string;

  @IsEnum(['M', 'F'])
  sexe!: 'M' | 'F';

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsString()
  poste!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  roles?: Array<{ role: RoleType; scope?: string }>;
}
