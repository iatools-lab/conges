import { IsOptional, IsString } from 'class-validator';

export class UpdateRhHierarchyDto {
  @IsOptional()
  @IsString()
  n1Id?: string | null;

  @IsOptional()
  @IsString()
  n2Id?: string | null;

  @IsOptional()
  @IsString()
  n3Id?: string | null;
}

export class UpdateRhDepartmentHeadDto {
  @IsString()
  managerId!: string;
}
