import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const RH_REQUEST_DECISIONS = ['approve', 'reject'] as const;

export type RhRequestDecision = (typeof RH_REQUEST_DECISIONS)[number];

export class DecideRhRequestDto {
  @IsOptional()
  @IsString()
  rhId?: string;

  @IsOptional()
  @IsEmail()
  rhEmail?: string;

  @IsIn(RH_REQUEST_DECISIONS)
  decision!: RhRequestDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
