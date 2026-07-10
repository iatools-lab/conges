import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { leaveYearForIsoDate } from "@/lib/leave-year";
import { countWorkingDays, endDateForWorkingDays, type HolidayRule } from "@/lib/working-days";
import type { AuthSession } from "@/modules/auth/session";
import { Plus } from "lucide-react";

export type NewRequestPayload = {
  leaveTypeCode: string;
  leaveSubtypeCode?: string;
  startDate: string;
  endDate: string;
  reason?: string;
  draft?: boolean;
  proof?: File;
};

export type LeaveTypeOption = {
  id?: string;
  code: string;
  name: string;
  category?: string;
  requiresProof: boolean;
  children?: LeaveTypeOption[];
};

type BalanceRow = {
  code: string;
  remaining: number;
};

const POOL_PAYE_CODE = "PAYE";
const POOL_SPECIAL_CODE = "SPECIAL";
const MATERNITY_CODE = "MAT";
const MATERNITY_REQUIRED_DAYS = 90;
const SPECIAL_POOL_CAP_DAYS = 12;
const PAID_SOURCE_CODES = new Set(["CP", "ANC", "ENF", "PASSIF"]);
const EXCLUDED_SPECIAL_CODES = new Set(["PASSIF", "MAT", "SS"]);

type BalancesResponse = {
  rows: BalanceRow[];
  totals?: {
    remaining: number;
  };
  specialTotals?: {
    remaining: number;
  };
};

type HolidaysResponse = {
  rows: Array<HolidayRule & { id: string }>;
};

export function NewRequestForm({
  trigger,
  session,
  leaveTypes,
  submitting = false,
  mode = "request",
  onSubmit,
}: {
  trigger?: ReactNode;
  session: AuthSession;
  leaveTypes: LeaveTypeOption[];
  submitting?: boolean;
  mode?: "request" | "planning";
  onSubmit: (payload: NewRequestPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [leaveTypeCode, setLeaveTypeCode] = useState(leaveTypes[0]?.code ?? "");
  const [leaveSubtypeCode, setLeaveSubtypeCode] = useState(
    leaveTypes[0]?.children?.[0]?.code ?? "",
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [balanceByCode, setBalanceByCode] = useState<Record<string, number>>({});
  const [balanceError, setBalanceError] = useState("");
  const [holidays, setHolidays] = useState<HolidayRule[]>([]);
  const [holidayError, setHolidayError] = useState("");
  const [proof, setProof] = useState<File | undefined>();
  const [proofError, setProofError] = useState(false);
  const [holidaysLoading, setHolidaysLoading] = useState(false);

  const requestYear = useMemo(() => leaveYearForIsoDate(startDate), [startDate]);
  const isMaternitySelection = normalizeCode(leaveTypeCode) === MATERNITY_CODE;
  const isPayeSelection = normalizeCode(leaveTypeCode) === POOL_PAYE_CODE;
  const selectedLeaveType = useMemo(
    () => leaveTypes.find((type) => type.code === leaveTypeCode),
    [leaveTypeCode, leaveTypes],
  );
  const subtypeOptions = useMemo(() => selectedLeaveType?.children ?? [], [selectedLeaveType]);
  const isSpecialSelection =
    normalizeCode(leaveTypeCode) === POOL_SPECIAL_CODE ||
    isSpecialLeaveSelection(selectedLeaveType);
  const proofRequired =
    !isSpecialSelection && !isMaternitySelection && (selectedLeaveType?.requiresProof ?? false);

  const requestedDays = useMemo(
    () => countWorkingDays(startDate, endDate, holidays),
    [endDate, holidays, startDate],
  );
  const availableDays = leaveTypeCode
    ? getAvailableDaysForSelection(leaveTypeCode, balanceByCode)
    : undefined;
  const hasFullMaternityBalance =
    !isMaternitySelection ||
    (typeof availableDays === "number" && roundDays(availableDays) >= MATERNITY_REQUIRED_DAYS);
  const exceedsBalance =
    requestedDays > 0 &&
    typeof availableDays === "number" &&
    requestedDays > roundDays(availableDays);
  const invalidMaternityDuration =
    isMaternitySelection && requestedDays > 0 && requestedDays !== MATERNITY_REQUIRED_DAYS;
  const hasInvalidWorkingPeriod = Boolean(startDate && endDate && requestedDays <= 0);

  const futureBalanceAfterRequest =
    typeof availableDays === "number" && requestedDays > 0
      ? roundDays(availableDays) - requestedDays
      : null;

  const inlineError = holidayError
    ? holidayError
    : hasInvalidWorkingPeriod
      ? "La période ne contient aucun jour ouvré."
      : isMaternitySelection
        ? !hasFullMaternityBalance
          ? `Le congé maternité doit être pris en totalité (${MATERNITY_REQUIRED_DAYS} jours), mais votre solde est insuffisant.`
          : invalidMaternityDuration
            ? `Le congé maternité doit être pris en totalité (${MATERNITY_REQUIRED_DAYS} jours ouvrés).`
            : ""
        : exceedsBalance && typeof availableDays === "number" && !isPayeSelection
          ? `Le nombre de jours de congés demandé (${requestedDays}) excède le solde disponible (${roundDays(availableDays)}).`
          : "";
  const isPlanning = mode === "planning";

  useEffect(() => {
    if (!leaveTypes.length) {
      setLeaveTypeCode("");
      return;
    }

    if (!leaveTypes.some((type) => type.code === leaveTypeCode)) {
      setLeaveTypeCode(leaveTypes[0].code);
    }
  }, [leaveTypes, leaveTypeCode]);

  useEffect(() => {
    if (!subtypeOptions.length) {
      setLeaveSubtypeCode("");
      return;
    }

    if (!subtypeOptions.some((type) => type.code === leaveSubtypeCode)) {
      setLeaveSubtypeCode(subtypeOptions[0].code);
    }
  }, [leaveSubtypeCode, subtypeOptions]);

  useEffect(() => {
    if (!open || !session?.id) return;

    let cancelled = false;
    setBalanceError("");

    apiFetch<BalancesResponse>(`/employee/balances/${session.id}?year=${requestYear}`)
      .then((response) => {
        if (cancelled) return;
        const nextMap = response.rows.reduce<Record<string, number>>((acc, row) => {
          acc[row.code] = row.remaining;
          return acc;
        }, {});
        if (response.specialTotals) {
          nextMap[POOL_SPECIAL_CODE] = response.specialTotals.remaining;
        }
        if (response.totals) {
          nextMap[POOL_PAYE_CODE] = response.totals.remaining;
        }
        setBalanceByCode(nextMap);
      })
      .catch(() => {
        if (cancelled) return;
        setBalanceByCode({});
        setBalanceError("Impossible de vérifier le solde disponible pour cette année.");
      });

    return () => {
      cancelled = true;
    };
  }, [open, requestYear, session?.id]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setHolidayError("");
    setHolidaysLoading(true);

    apiFetch<HolidaysResponse>("/employee/leave-requests/holidays")
      .then((response) => {
        if (!cancelled) setHolidays(response.rows);
      })
      .catch(() => {
        if (cancelled) return;
        setHolidays([]);
        setHolidayError("Impossible de charger le calendrier des jours fériés.");
      })
      .finally(() => {
        if (!cancelled) setHolidaysLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!isMaternitySelection || !startDate) return;

    const nextEndDate = endDateForWorkingDays(startDate, MATERNITY_REQUIRED_DAYS, holidays);
    if (nextEndDate !== endDate) {
      setEndDate(nextEndDate);
    }
  }, [endDate, holidays, isMaternitySelection, startDate]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" /> {isPlanning ? "Planifier" : "Nouvelle demande"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {isPlanning ? "Planifier un congé" : "Nouvelle demande de congé"}
          </DialogTitle>
          <DialogDescription>
            {isPlanning
              ? "Enregistrez une planification. Elle restera modifiable tant qu'elle n'est pas soumise."
              : "Complétez votre demande. Elle sera transmise à votre manager après enregistrement."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (inlineError) return;

            const formData = new FormData(e.currentTarget);
            const formProof = formData.get("proof");
            const submittedProof =
              formProof instanceof File && formProof.size > 0 ? formProof : proof;
            if (proofRequired && !submittedProof) {
              setProofError(true);
              return;
            }
            onSubmit({
              leaveTypeCode,
              startDate: String(formData.get("startDate") ?? ""),
              endDate: String(formData.get("endDate") ?? ""),
              reason: String(formData.get("reason") ?? "").trim() || undefined,
              draft: isPlanning || undefined,
              proof: submittedProof,
            });
            setOpen(false);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employé">
              <input
                readOnly
                value={`${session.name} — ${session.matricule}`}
                className="w-full rounded-md border px-3 py-2 text-sm bg-muted/50"
              />
            </Field>
            <Field label="Département">
              <input
                readOnly
                value={session.department?.name ?? "Non affecté"}
                className="w-full rounded-md border px-3 py-2 text-sm bg-muted/50"
              />
            </Field>
          </div>

          <Field label="Type de congé">
            <select
              required
              name="leaveTypeCode"
              value={leaveTypeCode}
              onChange={(event) => {
                const nextCode = event.target.value;
                const nextType = leaveTypes.find((type) => type.code === nextCode);
                setLeaveTypeCode(nextCode);
                setLeaveSubtypeCode(nextType?.children?.[0]?.code ?? "");
                setProof(undefined);
              }}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              {leaveTypes.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de début">
              <input
                required
                name="startDate"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              />
            </Field>
            <Field label="Date de fin">
              <input
                required
                name="endDate"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                disabled={isMaternitySelection}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              />
              {isMaternitySelection && <input type="hidden" name="endDate" value={endDate} />}
            </Field>
          </div>

          <Field label="Nombre de jours demandés">
            <div className="grid gap-1">
              <input
                readOnly
                value={requestedDays > 0 ? `${requestedDays} jour(s) ouvré(s)` : "-"}
                className="w-full rounded-md border px-3 py-2 text-sm bg-muted/50"
              />
              {typeof availableDays === "number" && (
                <p className="text-xs text-muted-foreground">
                  Solde disponible: {roundDays(availableDays)} jour(s)
                </p>
              )}
              {isPayeSelection && futureBalanceAfterRequest !== null && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Après validation de cette demande, votre solde sera de {futureBalanceAfterRequest}{" "}
                  jour(s).
                </p>
              )}
              {isMaternitySelection && (
                <p className="text-xs text-muted-foreground">
                  Le congé maternité doit être pris en totalité ({MATERNITY_REQUIRED_DAYS} jours
                  ouvrés).
                </p>
              )}
              {balanceError && <p className="text-xs text-muted-foreground">{balanceError}</p>}
              {inlineError && <p className="text-xs text-destructive">{inlineError}</p>}
            </div>
          </Field>

          <Field label={`Justificatif${proofRequired ? " (obligatoire)" : " (optionnel)"}`}>
            <input
              type="file"
              name="proof"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => {
                setProof(event.target.files?.[0]);
                setProofError(false);
              }}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
            />
            <span className="text-xs text-muted-foreground">PDF ou image, 5 Mo maximum.</span>
            {proofError && (
              <span className="text-xs text-destructive">Le justificatif est obligatoire.</span>
            )}
          </Field>

          <Field label="Commentaire">
            <textarea
              name="reason"
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              placeholder="Motif ou précisions utiles…"
            />
          </Field>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                holidaysLoading ||
                leaveTypes.length === 0 ||
                requestedDays <= 0 ||
                (Boolean(inlineError) && !isPayeSelection)
              }
            >
              {isPlanning ? "Enregistrer la planification" : "Envoyer la demande"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function roundDays(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function isPaidSourceCode(code: string) {
  return PAID_SOURCE_CODES.has(normalizeCode(code));
}

function isSpecialSourceCode(code: string) {
  const normalized = normalizeCode(code);
  return !isPaidSourceCode(normalized) && !EXCLUDED_SPECIAL_CODES.has(normalized);
}

function getAvailableDaysForSelection(
  leaveTypeCode: string,
  balanceByCode: Record<string, number>,
) {
  const normalized = normalizeCode(leaveTypeCode);

  if (normalized === POOL_PAYE_CODE) {
    if (typeof balanceByCode[POOL_PAYE_CODE] === "number") {
      return roundDays(balanceByCode[POOL_PAYE_CODE]);
    }

    return roundDays(
      Object.entries(balanceByCode)
        .filter(([code]) => isPaidSourceCode(code))
        .reduce((sum, [, remaining]) => sum + remaining, 0),
    );
  }

  if (normalized === POOL_SPECIAL_CODE) {
    if (typeof balanceByCode[POOL_SPECIAL_CODE] === "number") {
      return roundDays(balanceByCode[POOL_SPECIAL_CODE]);
    }

    const totalSpecial = Object.entries(balanceByCode)
      .filter(([code]) => isSpecialSourceCode(code))
      .reduce((sum, [, remaining]) => sum + Math.max(remaining, 0), 0);

    return roundDays(Math.min(totalSpecial, SPECIAL_POOL_CAP_DAYS));
  }

  return balanceByCode[normalized];
}

export function isSpecialLeaveSelection(leaveType?: LeaveTypeOption) {
  if (!leaveType) return false;

  const code = normalizeCode(leaveType.code);
  const category = leaveType.category?.trim().toUpperCase();

  return (
    code === POOL_SPECIAL_CODE ||
    code === "SPE" ||
    category === "CONGE_SPECIAL" ||
    category === "CONGE_PATERNITE" ||
    category === "CONGE_MALADIE"
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
