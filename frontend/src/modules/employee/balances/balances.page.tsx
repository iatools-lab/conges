import { AppShell } from "@/components/AppShell";
import { Button, Card, CardHeader } from "@/components/ui-kit";
import { AlertCircle, Info, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { leaveYearForDate } from "@/lib/leave-year";
import { useAuthSession } from "@/modules/auth/session";
import { useQuery } from "@tanstack/react-query";

type BalanceRow = {
  id: string;
  source: string;
  code: string;
  category: string;
  acquired: number;
  taken: number;
  scheduled: number;
  remaining: number;
};

type BalanceTotals = {
  acquired: number;
  taken: number;
  scheduled: number;
  remaining: number;
};

type EmployeeBalances = {
  year: number;
  paidDetails?: BalanceRow[];
  specialDetails?: BalanceRow[];
  maternityRows?: BalanceRow[];
  paidRows: BalanceRow[];
  specialRows: BalanceRow[];
  totals: BalanceTotals;
  specialTotals: BalanceTotals;
  maternityTotals?: BalanceTotals;
};

const emptyTotals: BalanceTotals = { acquired: 0, taken: 0, scheduled: 0, remaining: 0 };

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function BalanceTable({
  rows,
  totals,
  acquiredLabel = "Jours acquis",
}: {
  rows: BalanceRow[];
  totals: BalanceTotals;
  acquiredLabel?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground bg-muted/50">
          <tr>
            <th className="px-5 py-3">Source du droit</th>
            <th className="px-5 py-3">{acquiredLabel}</th>
            <th className="px-5 py-3">Jours pris</th>
            <th className="px-5 py-3">Jours planifiés</th>
            <th className="px-5 py-3">Solde restant</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id}>
                <td className="px-5 py-3 font-medium">
                  {row.source} <span className="text-xs text-muted-foreground">({row.code})</span>
                </td>
                <td className="px-5 py-3">{formatNumber(row.acquired)}</td>
                <td className="px-5 py-3">{formatNumber(row.taken)}</td>
                <td className="px-5 py-3">{formatNumber(row.scheduled)}</td>
                <td className="px-5 py-3 font-semibold">{formatNumber(row.remaining)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                Aucun solde initialisé pour cette année.
              </td>
            </tr>
          )}
          <tr className="bg-muted/40 font-semibold">
            <td className="px-5 py-3">Total</td>
            <td className="px-5 py-3">{formatNumber(totals.acquired)}</td>
            <td className="px-5 py-3">{formatNumber(totals.taken)}</td>
            <td className="px-5 py-3">{formatNumber(totals.scheduled)}</td>
            <td className="px-5 py-3">{formatNumber(totals.remaining)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Solde() {
  const { session } = useAuthSession();
  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["employee-balances", session?.id],
    queryFn: () => apiFetch<EmployeeBalances>(`/employee/balances/${session?.id}`),
    enabled: Boolean(session?.id),
  });
  const paidRows = data?.paidDetails?.length ? data.paidDetails : (data?.paidRows ?? []);
  const specialRows = data?.specialDetails?.length
    ? data.specialDetails
    : (data?.specialRows ?? []);
  const maternityRows = data?.maternityRows ?? [];
  const totals = data?.totals ?? emptyTotals;
  const specialTotals = data?.specialTotals ?? emptyTotals;
  const maternityTotals = data?.maternityTotals ?? emptyTotals;

  return (
    <AppShell title="Mon solde de congés">
      {isError && (
        <Card className="mb-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger vos soldes depuis le backend.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Détail des congés payés ${data?.year ?? leaveYearForDate()}`} />
        {isLoading ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">Chargement des soldes...</div>
        ) : (
          <BalanceTable rows={paidRows} totals={totals} />
        )}
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader title="Congés spéciaux (plafond annuel 12 jours)" />
          {isLoading ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">
              Chargement des congés spéciaux...
            </div>
          ) : (
            <BalanceTable
              rows={specialRows}
              totals={specialTotals}
              acquiredLabel="Droit par type"
            />
          )}
          <div className="px-5 py-3 text-xs text-muted-foreground flex items-center gap-2 border-t">
            <Info className="size-4" /> Tous les congés spéciaux actifs sont détaillés ci-dessus.
            Ils consomment le même quota annuel de 12 jours : solde restant = 12 − jours pris −
            jours planifiés.
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Congé maternité" />
          {isLoading ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">
              Chargement du congé maternité...
            </div>
          ) : (
            <BalanceTable rows={maternityRows} totals={maternityTotals} />
          )}
        </Card>
      </div>
    </AppShell>
  );
}
