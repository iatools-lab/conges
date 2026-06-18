import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export const RH_ALERT_SEVERITIES = ['high', 'medium', 'low'] as const;
export const RH_ALERT_STATUSES = ['active', 'resolved', 'ignored'] as const;

export type RhAlertSeverity = (typeof RH_ALERT_SEVERITIES)[number];
export type RhAlertStatus = (typeof RH_ALERT_STATUSES)[number];

export class UpdateRhAlertRuleDto {
  @IsOptional()
  @IsString()
  rule?: string;

  @IsOptional()
  @IsIn(RH_ALERT_SEVERITIES)
  severity?: RhAlertSeverity;

  @IsOptional()
  @IsString()
  threshold?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateRhAlertStatusDto {
  @IsIn(RH_ALERT_STATUSES)
  status!: RhAlertStatus;
}
