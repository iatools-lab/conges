export type HolidayRule = {
  date: string;
  recurring?: boolean;
  name?: string;
};

function toUtcDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function isHoliday(date: Date, holidays: HolidayRule[]) {
  const dateKey = date.toISOString().slice(0, 10);
  const monthDay = dateKey.slice(5);

  return holidays.some((holiday) => {
    const holidayKey = holiday.date.slice(0, 10);
    return holiday.recurring ? holidayKey.slice(5) === monthDay : holidayKey === dateKey;
  });
}

export function countWorkingDays(startDate: string, endDate: string, holidays: HolidayRule[] = []) {
  if (!startDate || !endDate) return 0;

  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return 0;
  }

  let days = 0;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !isHoliday(cursor, holidays)) days += 1;
  }

  return days;
}

export function endDateForWorkingDays(
  startDate: string,
  requiredWorkingDays: number,
  holidays: HolidayRule[] = [],
) {
  const start = toUtcDate(startDate);
  if (Number.isNaN(start.getTime())) return "";

  let countedDays = 0;
  const cursor = new Date(start);

  while (countedDays < requiredWorkingDays) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !isHoliday(cursor, holidays)) countedDays += 1;
    if (countedDays < requiredWorkingDays) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return cursor.toISOString().slice(0, 10);
}
