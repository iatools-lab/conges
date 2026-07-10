const FISCAL_START_MONTH = 3; // April, zero-based.
const TRANSITION_YEAR = 2028;
const FISCAL_LEAVE_YEARS = new Set([2026, 2027]);

export type LeaveYearRangeValue = {
  dateFrom: string;
  dateTo: string;
};

export function leaveYearForDate(date = new Date()) {
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const fiscalStart = new Date(2026, FISCAL_START_MONTH, 1);
  const fiscalEnd = new Date(TRANSITION_YEAR, FISCAL_START_MONTH, 1);

  if (normalized >= fiscalStart && normalized < fiscalEnd) {
    return date.getMonth() < FISCAL_START_MONTH ? date.getFullYear() - 1 : date.getFullYear();
  }

  return date.getFullYear();
}

export function leaveYearForIsoDate(value: string, fallback = leaveYearForDate()) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return fallback;

  return leaveYearForDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function leaveYearRange(year: number): LeaveYearRangeValue {
  if (FISCAL_LEAVE_YEARS.has(year) || year === TRANSITION_YEAR) {
    return {
      dateFrom: `${year}-04-01`,
      dateTo: year === TRANSITION_YEAR ? `${year}-12-31` : `${year + 1}-03-31`,
    };
  }

  return {
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
  };
}
