import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type DateRangeInput = {
  dateFrom?: string | null;
  dateTo?: string | null;
  year?: number | string | null;
  month?: number | string | null;
};

type ResolveDateRangeOptions = {
  defaultMode?: 'year' | 'month' | 'all';
  now?: Date;
};

export type ResolvedDateRange = {
  dateFrom: Date | null;
  dateTo: Date | null;
  endExclusive: Date | null;
  year: number;
  month: number | null;
  dateFromIso: string | null;
  dateToIso: string | null;
};

export function resolveDateRange(
  input: DateRangeInput,
  options: ResolveDateRangeOptions = {},
): ResolvedDateRange {
  const now = options.now ?? new Date();
  const defaultMode = options.defaultMode ?? 'year';
  const hasDateRange = Boolean(input.dateFrom || input.dateTo);

  let dateFrom: Date | null = null;
  let dateTo: Date | null = null;
  let month: number | null = null;

  if (hasDateRange) {
    dateFrom = input.dateFrom
      ? parseIsoDate(input.dateFrom, 'dateFrom')
      : null;
    dateTo = input.dateTo ? parseIsoDate(input.dateTo, 'dateTo') : null;
  } else if (input.year || input.month) {
    const year = parseYear(input.year, now.getUTCFullYear());
    month = input.month ? parseMonth(input.month) : null;
    if (month) {
      dateFrom = new Date(Date.UTC(year, month - 1, 1));
      dateTo = new Date(Date.UTC(year, month, 0));
    } else {
      dateFrom = new Date(Date.UTC(year, 0, 1));
      dateTo = new Date(Date.UTC(year, 11, 31));
    }
  } else if (defaultMode === 'month') {
    month = now.getUTCMonth() + 1;
    dateFrom = new Date(Date.UTC(now.getUTCFullYear(), month - 1, 1));
    dateTo = new Date(Date.UTC(now.getUTCFullYear(), month, 0));
  } else if (defaultMode === 'year') {
    dateFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    dateTo = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new BadRequestException('dateFrom doit etre avant ou egal a dateTo');
  }

  const year = dateFrom?.getUTCFullYear() ?? now.getUTCFullYear();

  return {
    dateFrom,
    dateTo,
    endExclusive: dateTo ? addUtcDays(dateTo, 1) : null,
    year,
    month,
    dateFromIso: dateFrom ? toIsoDate(dateFrom) : null,
    dateToIso: dateTo ? toIsoDate(dateTo) : null,
  };
}

export function overlapDateWhere(
  range: ResolvedDateRange,
): Prisma.LeaveRequestWhereInput {
  return {
    ...(range.endExclusive ? { startDate: { lt: range.endExclusive } } : {}),
    ...(range.dateFrom ? { endDate: { gte: range.dateFrom } } : {}),
  };
}

export function fieldDateWhere(
  range: ResolvedDateRange,
): Prisma.DateTimeFilter | undefined {
  if (!range.dateFrom && !range.endExclusive) return undefined;

  return {
    ...(range.dateFrom ? { gte: range.dateFrom } : {}),
    ...(range.endExclusive ? { lt: range.endExclusive } : {}),
  };
}

export function yearsInRange(range: ResolvedDateRange) {
  if (!range.dateFrom || !range.dateTo) return [range.year];

  const years: number[] = [];
  for (
    let year = range.dateFrom.getUTCFullYear();
    year <= range.dateTo.getUTCFullYear();
    year += 1
  ) {
    years.push(year);
  }

  return years.length ? years : [range.year];
}

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string, field: string) {
  const raw = value.trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new BadRequestException(`${field} invalide`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!valid) throw new BadRequestException(`${field} invalide`);

  return date;
}

function parseYear(value: number | string | null | undefined, fallback: number) {
  if (value === null || value === undefined || value === '') return fallback;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new BadRequestException('Annee invalide');
  }

  return year;
}

function parseMonth(value: number | string) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException('Mois invalide');
  }

  return month;
}

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}
