import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RoleType } from '@prisma/client';

export class CreateRoleDto {
  @IsString()
  userId!: string;

  @IsEnum(RoleType)
  role!: RoleType;

  @IsOptional()
  @IsString()
  scope?: string;
}
