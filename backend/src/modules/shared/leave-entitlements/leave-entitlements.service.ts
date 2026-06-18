import { Injectable } from '@nestjs/common';
import { EventType, LeaveCategory, Sexe } from '@prisma/client';

type EntitlementUser = {
  sexe: Sexe;
  dateEmbauche: Date;
  passifInitial?: number | null;
  children?: { dateNaissance: Date }[];
  events?: { type: EventType; eventDate: Date; processed: boolean }[];
};

type EntitlementLeaveType = {
  code: string;
  name: string;
  category: LeaveCategory;
  defaultDays: number;
};

const ANNUAL_PAID_LEAVE_DAYS = 24;
const MONTHLY_PAID_LEAVE_DAYS = 2;
const CYCLE_MONTHS = 12;
const SENIORITY_STEP_YEARS = 5;
const SENIORITY_STEP_DAYS = 3;
const CHILD_BONUS_DAYS = 2;
const CHILD_BONUS_MAX_AGE = 6;
const MATERNITY_LEAVE_DAYS = 90;
const PATERNITY_BONUS_DAYS = 3;
const SPECIAL_LEAVE_QUOTA_DAYS = 12;
const PASSIVE_LEAVE_YEARS = [2025, 2026, 2027] as const;
export const MAX_PASSIVE_LEAVE_DAYS = 72;

@Injectable()
export class LeaveEntitlementsService {
  getAcquiredDays(params: {
    leaveType: EntitlementLeaveType;
    user: EntitlementUser;
    year: number;
  }) {
    const code = this.normalizeCode(params.leaveType.code);
    const referenceDate = this.getReferenceDate(params.year);

    if (code === 'CP') {
      return this.getPaidLeaveDays(
        params.user.dateEmbauche,
        params.year,
        this.configuredDays(params.leaveType.defaultDays, ANNUAL_PAID_LEAVE_DAYS),
      );
    }
    if (code === 'ANC')
      return this.getSeniorityBonusDays(
        params.user.dateEmbauche,
        referenceDate,
      );
    if (code === 'ENF')
      return this.getChildBonusDays(
        params.user,
        referenceDate,
        this.configuredDays(params.leaveType.defaultDays, CHILD_BONUS_DAYS),
      );
    if (code === 'MAT')
      return this.getMaternityDays(
        params.user,
        params.year,
        this.configuredDays(params.leaveType.defaultDays, MATERNITY_LEAVE_DAYS),
      );
    if (code === 'PAT')
      return this.getPaternityDays(
        params.user,
        params.year,
        this.configuredDays(params.leaveType.defaultDays, PATERNITY_BONUS_DAYS),
      );
    if (code === 'SPE') {
      return this.roundDays(
        params.leaveType.defaultDays > 0
          ? params.leaveType.defaultDays
          : SPECIAL_LEAVE_QUOTA_DAYS,
      );
    }
    if (code === 'PASSIF') {
      return this.getPassiveLeaveDays(
        params.user.passifInitial ?? params.leaveType.defaultDays,
        params.year,
      );
    }

    return this.roundDays(params.leaveType.defaultDays);
  }

  getSeniorityBonusDays(hireDate: Date, referenceDate = new Date()) {
    const years = this.getCompletedYears(hireDate, referenceDate);

    return Math.floor(years / SENIORITY_STEP_YEARS) * SENIORITY_STEP_DAYS;
  }

  getPaidLeaveDays(
    hireDate: Date,
    year: number,
    annualDays = ANNUAL_PAID_LEAVE_DAYS,
    today = new Date(),
  ) {
    const cycleStart = this.getCycleStart(hireDate, year);
    const cycleEnd = this.addUtcYears(cycleStart, 1);
    const referenceDate = year === today.getUTCFullYear() ? today : cycleEnd;
    const cappedReference = referenceDate < cycleStart ? cycleStart : referenceDate;

    if (cappedReference <= cycleStart) return 0;

    const completedMonths = this.getCompletedMonths(cycleStart, cappedReference);
    const maxDays = Math.max(annualDays, 0);

    return this.roundDays(
      Math.min(completedMonths * MONTHLY_PAID_LEAVE_DAYS, maxDays),
    );
  }

  getChildBonusDays(
    user: EntitlementUser,
    referenceDate = new Date(),
    daysPerEligibleChild = CHILD_BONUS_DAYS,
  ) {
    if (user.sexe !== Sexe.F) return 0;

    const eligibleChildren = (user.children ?? []).filter((child) =>
      this.isYoungerThan(
        child.dateNaissance,
        CHILD_BONUS_MAX_AGE,
        referenceDate,
      ),
    ).length;
    const validatedBirthEvents = (user.events ?? []).filter(
      (event) =>
        event.type === EventType.BIRTH &&
        event.processed &&
        this.isYoungerThan(event.eventDate, CHILD_BONUS_MAX_AGE, referenceDate),
    ).length;

    return Math.min(eligibleChildren, validatedBirthEvents) * daysPerEligibleChild;
  }

  getMaternityDays(
    user: EntitlementUser,
    year: number,
    daysPerValidatedBirth = MATERNITY_LEAVE_DAYS,
  ) {
    if (user.sexe !== Sexe.F) return 0;

    // 90 days credited once per validated birth, tracked by the year the birth occurred.
    // A new baby in a later year grants another 90 days for that year.
    const validatedBirthsInYear = (user.events ?? []).filter(
      (event) =>
        event.type === EventType.BIRTH &&
        event.processed &&
        event.eventDate.getUTCFullYear() === year,
    ).length;

    return validatedBirthsInYear * daysPerValidatedBirth;
  }

  getPaternityDays(
    user: EntitlementUser,
    year: number,
    daysPerValidatedBirth = PATERNITY_BONUS_DAYS,
  ) {
    if (user.sexe !== Sexe.M) return 0;

    const validatedBirthEvents = (user.events ?? []).filter(
      (event) =>
        event.type === EventType.BIRTH &&
        event.processed &&
        event.eventDate.getUTCFullYear() === year,
    ).length;

    return validatedBirthEvents * daysPerValidatedBirth;
  }

  getPassiveLeaveDays(totalPassiveDays: number, year: number) {
    const yearIndex = PASSIVE_LEAVE_YEARS.findIndex(
      (passiveYear) => passiveYear === year,
    );
    if (yearIndex === -1) return 0;

    const totalDays = Math.min(
      Math.max(Math.round(totalPassiveDays), 0),
      MAX_PASSIVE_LEAVE_DAYS,
    );
    const baseDays = Math.floor(totalDays / PASSIVE_LEAVE_YEARS.length);
    const remainingDays = totalDays % PASSIVE_LEAVE_YEARS.length;

    return baseDays + (yearIndex < remainingDays ? 1 : 0);
  }

  getBalanceLabel(leaveType: { code: string; name: string }, year: number) {
    const code = this.normalizeCode(leaveType.code);

    if (code === 'CP') return `${leaveType.name} acquis en ${year - 1}`;
    if (code === 'PASSIF') return `Passif régularisé ${year}`;
    if (code === 'ANC') return 'Ancienneté';
    if (code === 'ENF') return 'Congé enfant (naissances validées RH)';

    return leaveType.name;
  }

  isSpecialLeave(leaveType: { category: LeaveCategory; code: string }) {
    return (
      leaveType.category === LeaveCategory.CONGE_SPECIAL ||
      this.normalizeCode(leaveType.code) === 'SPE'
    );
  }

  normalizeCode(code: string) {
    return code.trim().toUpperCase();
  }

  private configuredDays(value: number, fallback: number) {
    return value > 0 ? value : fallback;
  }

  private getReferenceDate(year: number) {
    const today = new Date();
    const currentYear = today.getUTCFullYear();

    if (year === currentYear) return today;

    return new Date(Date.UTC(year, 11, 31));
  }

  private getCycleStart(hireDate: Date, year: number) {
    return new Date(
      Date.UTC(year - 1, hireDate.getUTCMonth(), hireDate.getUTCDate()),
    );
  }

  private addUtcYears(date: Date, years: number) {
    return new Date(
      Date.UTC(
        date.getUTCFullYear() + years,
        date.getUTCMonth(),
        date.getUTCDate(),
      ),
    );
  }

  private getCompletedMonths(startDate: Date, referenceDate: Date) {
    const yearDiff =
      referenceDate.getUTCFullYear() - startDate.getUTCFullYear();
    const monthDiff = referenceDate.getUTCMonth() - startDate.getUTCMonth();
    let months = yearDiff * CYCLE_MONTHS + monthDiff;

    if (referenceDate.getUTCDate() < startDate.getUTCDate()) {
      months -= 1;
    }

    return Math.max(months, 0);
  }

  private getCompletedYears(startDate: Date, referenceDate: Date) {
    let years = referenceDate.getUTCFullYear() - startDate.getUTCFullYear();
    const beforeAnniversary =
      referenceDate.getUTCMonth() < startDate.getUTCMonth() ||
      (referenceDate.getUTCMonth() === startDate.getUTCMonth() &&
        referenceDate.getUTCDate() < startDate.getUTCDate());

    if (beforeAnniversary) years -= 1;

    return Math.max(years, 0);
  }

  private isYoungerThan(date: Date, maxAge: number, referenceDate: Date) {
    const birthday = new Date(
      Date.UTC(
        date.getUTCFullYear() + maxAge,
        date.getUTCMonth(),
        date.getUTCDate(),
      ),
    );

    return birthday > referenceDate;
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
