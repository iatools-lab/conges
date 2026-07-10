export type LeaveYearRange = {
  year: number;
  start: Date;
  endExclusive: Date;
  endInclusive: Date;
};

const FISCAL_LEAVE_YEARS = new Set([2026, 2027]);
const TRANSITION_YEAR = 2028;
const FISCAL_START_MONTH = 3; // April, zero-based.

export function getLeaveYear(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  if (
    date >= new Date(Date.UTC(2026, FISCAL_START_MONTH, 1)) &&
    date < new Date(Date.UTC(TRANSITION_YEAR, FISCAL_START_MONTH, 1))
  ) {
    return month < FISCAL_START_MONTH ? year - 1 : year;
  }

  return year;
}

export function getCurrentLeaveYear(now = new Date()) {
  return getLeaveYear(
    new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ),
  );
}

export function getLeaveYearRange(year: number): LeaveYearRange {
  const start = getLeaveYearStart(year);
  const endExclusive = getLeaveYearEndExclusive(year);
  const endInclusive = new Date(endExclusive);
  endInclusive.setUTCDate(endInclusive.getUTCDate() - 1);

  return { year, start, endExclusive, endInclusive };
}

export function getLeaveYearsForPeriod(startDate: Date, endDate: Date) {
  return splitPeriodByLeaveYear(startDate, endDate).map(
    (segment) => segment.year,
  );
}

export function splitPeriodByLeaveYear(startDate: Date, endDate: Date) {
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate > endDate
  ) {
    return [] as Array<{ year: number; startDate: Date; endDate: Date }>;
  }

  const segments: Array<{ year: number; startDate: Date; endDate: Date }> = [];
  let cursor = toUtcDay(startDate);
  const end = toUtcDay(endDate);

  while (cursor <= end) {
    const year = getLeaveYear(cursor);
    const range = getLeaveYearRange(year);
    const segmentEnd =
      range.endInclusive < end ? range.endInclusive : new Date(end);

    segments.push({
      year,
      startDate: new Date(cursor),
      endDate: new Date(segmentEnd),
    });

    cursor = new Date(segmentEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return segments;
}

export function isFiscalLeaveYear(year: number) {
  return FISCAL_LEAVE_YEARS.has(year);
}

function getLeaveYearStart(year: number) {
  if (FISCAL_LEAVE_YEARS.has(year) || year === TRANSITION_YEAR) {
    return new Date(Date.UTC(year, FISCAL_START_MONTH, 1));
  }

  return new Date(Date.UTC(year, 0, 1));
}

function getLeaveYearEndExclusive(year: number) {
  if (FISCAL_LEAVE_YEARS.has(year)) {
    return new Date(Date.UTC(year + 1, FISCAL_START_MONTH, 1));
  }

  return new Date(Date.UTC(year + 1, 0, 1));
}

function toUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
