import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import {
  Calendar,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

type ExportTemplateId =
  | "monthly-balances"
  | "leave-journal"
  | "payroll-variables"
  | "social-report"
  | "passive-liability"
  | "absence-audit";

type ExportTemplate = {
  id: ExportTemplateId;
  name: string;
  description: string;
  format: "CSV";
  frequency: "Mensuel" | "Annuel" | "À la demande";
};

type ScheduledExport = {
  templateId: ExportTemplateId;
  name: string;
  frequency: string;
  status: "active";
};

type ExportHistoryRow = {
  id: string;
  templateId: string | null;
  templateName: string;
  filename: string;
  actorName: string;
  sizeBytes: number;
  sizeLabel: string;
  generatedAt: string;
  generatedAtLabel: string;
};

type ExportsResponse = {
  templates: ExportTemplate[];
  scheduled: ScheduledExport[];
  history: ExportHistoryRow[];
  stats: {
    exportsThisMonth: number;
    scheduledExports: number;
    downloads: number;
    totalSizeBytes: number;
  };
};

type GeneratedExport = {
  auditLogId: string;
  templateId: ExportTemplateId;
  filename: string;
  mimeType: string;
  content: string;
  sizeBytes: number;
  generatedAt: string;
};

type SessionActor = {
  email?: string;
  name?: string;
};

const emptyTemplates: ExportTemplate[] = [];
const emptyScheduled: ScheduledExport[] = [];
const emptyHistory: ExportHistoryRow[] = [];
const emptyStats: ExportsResponse["stats"] = {
  exportsThisMonth: 0,
  scheduledExports: 0,
  downloads: 0,
  totalSizeBytes: 0,
};

const templateIcons: Record<ExportTemplateId, typeof FileSpreadsheet> = {
  "monthly-balances": FileSpreadsheet,
  "leave-journal": FileText,
  "payroll-variables": FileSpreadsheet,
  "social-report": FileText,
  "passive-liability": FileSpreadsheet,
  "absence-audit": FileText,
};

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10} Mo`;
  if (bytes >= 1024) return `${Math.round((bytes / 1024) * 10) / 10} Ko`;
  return `${bytes} o`;
}

function getSessionActor(): SessionActor {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("upowa.auth.session");
    if (!raw) return {};
    const session = JSON.parse(raw) as { email?: string; name?: string };
    return { email: session.email, name: session.name };
  } catch {
    return {};
  }
}

function downloadGeneratedExport(exportFile: GeneratedExport) {
  const blob = new Blob([exportFile.content], { type: exportFile.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFile.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function RhExports() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState("");

  const exportsQuery = useQuery({
    queryKey: ["rh-exports"],
    queryFn: () => apiFetch<ExportsResponse>("/rh/exports"),
  });

  const templates = exportsQuery.data?.templates ?? emptyTemplates;
  const scheduled = exportsQuery.data?.scheduled ?? emptyScheduled;
  const history = exportsQuery.data?.history ?? emptyHistory;
  const stats = exportsQuery.data?.stats ?? emptyStats;

  const generateExport = useMutation({
    mutationFn: (templateId: ExportTemplateId) => {
      const actor = getSessionActor();
      return apiFetch<GeneratedExport>(`/rh/exports/${templateId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          year: Number(year),
          actorEmail: actor.email,
          actorName: actor.name,
        }),
      });
    },
    onSuccess: (exportFile) => {
      downloadGeneratedExport(exportFile);
      toast.success(`Export généré: ${exportFile.filename}`);
      void queryClient.invalidateQueries({ queryKey: ["rh-exports"] });
    },
    onError: (error) => {
      toast.error("Génération impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const filteredHistory = useMemo(() => {
    const query = search.trim().toLowerCase();
    return history.filter(
      (row) =>
        !query ||
        row.filename.toLowerCase().includes(query) ||
        row.templateName.toLowerCase().includes(query) ||
        row.actorName.toLowerCase().includes(query),
    );
  }, [history, search]);

  return (
    <AppShell title="Exports" subtitle="Générer et télécharger les rapports RH">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Exports ce mois" value={stats.exportsThisMonth} tone="blue" />
        <StatCard label="Programmés" value={stats.scheduledExports} tone="purple" />
        <StatCard label="Historique" value={stats.downloads} tone="green" />
        <StatCard label="Taille totale" value={formatSize(stats.totalSizeBytes)} tone="orange" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Modèles d'export"
          action={
            <div className="flex items-center gap-2">
              <input
                className="w-24 rounded-md border bg-background px-3 py-2 text-sm"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(event) => setYear(event.target.value)}
              />
              <Button
                variant="outline"
                disabled={exportsQuery.isFetching}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["rh-exports"] })}
              >
                <RefreshCw className="size-4" /> Actualiser
              </Button>
            </div>
          }
        />
        {exportsQuery.isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Chargement des modèles d'export...
          </div>
        ) : exportsQuery.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            Impossible de charger les exports.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => {
              const Icon = templateIcons[template.id];
              const isGenerating = generateExport.isPending;

              return (
                <div
                  key={template.id}
                  className="rounded-lg border bg-background p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex size-10 items-center justify-center rounded-md bg-stat-blue text-stat-blue-fg">
                      <Icon className="size-5" />
                    </div>
                    <Badge tone="neutral">{template.format}</Badge>
                  </div>
                  <h4 className="text-sm font-semibold">{template.name}</h4>
                  <p className="mb-3 mt-1 min-h-10 text-xs text-muted-foreground">
                    {template.description}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" /> {template.frequency}
                    </span>
                    <Button
                      variant="outline"
                      className="!px-3 !py-1.5 text-xs"
                      disabled={isGenerating}
                      onClick={() => generateExport.mutate(template.id)}
                    >
                      <Download className="size-3.5" /> Générer
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Exports planifiés"
          action={
            <Badge tone="info">
              <Calendar className="mr-1 size-3" /> Mensuel
            </Badge>
          }
        />
        <div className="grid gap-2 p-5 text-sm">
          {scheduled.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              Aucun export planifié.
            </div>
          ) : (
            scheduled.map((item) => (
              <div
                key={item.templateId}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Génération mensuelle disponible pour l'année sélectionnée.
                  </div>
                </div>
                <Badge tone="valid">Actif</Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold">Historique des exports</h3>
          <div className="relative min-w-0 sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
              placeholder="Fichier, modèle, utilisateur..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {filteredHistory.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Aucun export dans l'historique.
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-4 lg:hidden">
              {filteredHistory.map((row) => (
                <article key={row.id} className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{row.filename}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{row.templateName}</div>
                    </div>
                    <Badge tone="neutral">{row.sizeLabel}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div className="rounded-md bg-muted/45 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Généré le</div>
                      <div className="mt-1 font-medium">{row.generatedAtLabel}</div>
                    </div>
                    <div className="rounded-md bg-muted/45 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Utilisateur</div>
                      <div className="mt-1 font-medium">{row.actorName}</div>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">Date</th>
                    <th className="px-3 py-3 text-left font-medium">Fichier</th>
                    <th className="px-3 py-3 text-left font-medium">Modèle</th>
                    <th className="px-3 py-3 text-left font-medium">Utilisateur</th>
                    <th className="px-5 py-3 text-right font-medium">Taille</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-5 py-3 text-muted-foreground">{row.generatedAtLabel}</td>
                      <td className="px-3 py-3 font-medium">{row.filename}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.templateName}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.actorName}</td>
                      <td className="px-5 py-3 text-right text-muted-foreground">
                        {row.sizeLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </AppShell>
  );
}
