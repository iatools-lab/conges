import { CalendarDays, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui-kit";
import { leaveYearForDate, leaveYearRange as buildLeaveYearRange } from "@/lib/leave-year";

export type DateRangeValue = {
  dateFrom: string;
  dateTo: string;
};

type DateRangeFilterProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  compact?: boolean;
};

export function currentMonthRange(date = new Date()): DateRangeValue {
  const year = date.getFullYear();
  const month = date.getMonth();
  return monthRange(year, month);
}

export function monthRange(year: number, monthIndex: number): DateRangeValue {
  return {
    dateFrom: toInputDate(new Date(year, monthIndex, 1)),
    dateTo: toInputDate(new Date(year, monthIndex + 1, 0)),
  };
}

export function currentYearRange(date = new Date()): DateRangeValue {
  const year = leaveYearForDate(date);
  return yearRange(year);
}

export function yearRange(year: number): DateRangeValue {
  return buildLeaveYearRange(year);
}

export function previousYearRange(date = new Date()): DateRangeValue {
  return yearRange(leaveYearForDate(date) - 1);
}

export function allDateRange(): DateRangeValue {
  return { dateFrom: "", dateTo: "" };
}

export function isInvalidDateRange(value: DateRangeValue) {
  return Boolean(value.dateFrom && value.dateTo && value.dateFrom > value.dateTo);
}

export function appendDateRange(params: URLSearchParams, value: DateRangeValue) {
  if (value.dateFrom) params.set("dateFrom", value.dateFrom);
  if (value.dateTo) params.set("dateTo", value.dateTo);
  return params;
}

export function dateRangeQueryKey(value: DateRangeValue) {
  return [value.dateFrom || "all", value.dateTo || "all"] as const;
}

export function dateRangeYear(value: DateRangeValue, fallback = new Date().getFullYear()) {
  return Number(value.dateFrom.slice(0, 4)) || fallback;
}

export function dateRangeMonthIndex(value: DateRangeValue, fallback = new Date().getMonth()) {
  if (!value.dateFrom) return fallback;
  const month = Number(value.dateFrom.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : fallback;
}

export function isDateInRange(date: string, range: DateRangeValue) {
  if (!range.dateFrom && !range.dateTo) return true;
  if (!date) return false;
  return (!range.dateFrom || date >= range.dateFrom) && (!range.dateTo || date <= range.dateTo);
}

export function DateRangeFilter({
  value,
  onChange,
  className = "",
  compact = false,
}: DateRangeFilterProps) {
  const invalid = isInvalidDateRange(value);

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Date debut
        <input
          type="date"
          value={value.dateFrom}
          onChange={(event) => onChange({ ...value, dateFrom: event.target.value })}
          className={`h-9 rounded-md border bg-background px-3 text-sm text-foreground ${
            invalid ? "border-destructive" : ""
          }`}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Date fin
        <input
          type="date"
          value={value.dateTo}
          onChange={(event) => onChange({ ...value, dateTo: event.target.value })}
          className={`h-9 rounded-md border bg-background px-3 text-sm text-foreground ${
            invalid ? "border-destructive" : ""
          }`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="px-3 py-1.5"
          onClick={() => onChange(currentMonthRange())}
        >
          <CalendarDays className="size-4" />
          {compact ? "Mois" : "Mois courant"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="px-3 py-1.5"
          onClick={() => onChange(currentYearRange())}
        >
          {compact ? "Annee" : "Annee courante"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="px-3 py-1.5"
          onClick={() => onChange(previousYearRange())}
        >
          N-1
        </Button>
        <Button
          type="button"
          variant="outline"
          className="px-3 py-1.5"
          onClick={() => onChange(allDateRange())}
        >
          <RotateCcw className="size-4" />
          Tout
        </Button>
      </div>
    </div>
  );
}

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
