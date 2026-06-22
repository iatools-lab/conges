import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RemarkRhRequestDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  comment!: string;
}
