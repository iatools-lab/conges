export type HolidayRule = {
  date: Date | string;
  recurring?: boolean;
};

export function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function expandHolidayDateKeys(
  holidays: HolidayRule[],
  start: Date,
  end: Date,
) {
  const keys = new Set<string>();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  for (const holiday of holidays) {
    const date =
      holiday.date instanceof Date ? holiday.date : new Date(holiday.date);
    if (Number.isNaN(date.getTime())) continue;

    if (!holiday.recurring) {
      if (date >= start && date <= end) keys.add(utcDateKey(date));
      continue;
    }

    for (let year = startYear; year <= endYear; year += 1) {
      const occurrence = new Date(
        Date.UTC(year, date.getUTCMonth(), date.getUTCDate()),
      );
      if (
        occurrence.getUTCMonth() !== date.getUTCMonth() ||
        occurrence.getUTCDate() !== date.getUTCDate()
      ) {
        continue;
      }
      if (occurrence >= start && occurrence <= end) {
        keys.add(utcDateKey(occurrence));
      }
    }
  }

  return keys;
}

export function countWorkingDays(
  start: Date,
  end: Date,
  holidays: HolidayRule[] = [],
) {
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return 0;
  }

  const holidayKeys = expandHolidayDateKeys(holidays, start, end);
  let days = 0;

  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !holidayKeys.has(utcDateKey(cursor))) {
      days += 1;
    }
  }

  return days;
}

export function endDateForWorkingDays(
  start: Date,
  requiredWorkingDays: number,
  holidays: HolidayRule[] = [],
) {
  if (Number.isNaN(start.getTime()) || requiredWorkingDays <= 0) {
    return new Date(start);
  }

  let countedDays = 0;
  const cursor = new Date(start);

  while (countedDays < requiredWorkingDays) {
    const day = cursor.getUTCDay();
    const key = utcDateKey(cursor);
    const monthDay = key.slice(5);
    const holiday = holidays.some((rule) => {
      const ruleDate =
        rule.date instanceof Date ? rule.date : new Date(rule.date);
      if (Number.isNaN(ruleDate.getTime())) return false;
      const ruleKey = utcDateKey(ruleDate);
      return rule.recurring ? ruleKey.slice(5) === monthDay : ruleKey === key;
    });

    if (day !== 0 && day !== 6 && !holiday) countedDays += 1;
    if (countedDays < requiredWorkingDays) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return cursor;
}
