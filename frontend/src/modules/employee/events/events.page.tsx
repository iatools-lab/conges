import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  allDateRange,
  appendDateRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, FileText, Paperclip, Plus } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

type EventStatusTone = "valid" | "pending";

type EventRow = {
  id: string;
  type: string;
  typeLabel: string;
  eventDate: string;
  createdAt: string;
  description: string;
  hasProof: boolean;
  processed: boolean;
  statusLabel: string;
  statusTone: EventStatusTone;
};

type EventsResponse = {
  rows: EventRow[];
};

const emptyRows: EventRow[] = [];

function buildEventsPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
    limit: "50",
  });
  appendDateRange(params, range);

  return `/employee/events?${params.toString()}`;
}

export function Declarer() {
  const { ready, session } = useAuthSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("BIRTH");
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [childBirthDate, setChildBirthDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [otherEventType, setOtherEventType] = useState("");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => allDateRange());
  const queryKey = [
    "employee-events",
    session?.id,
    session?.email,
    ...dateRangeQueryKey(dateRange),
  ];

  const eventsQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<EventsResponse>(buildEventsPath(session!, dateRange)),
    enabled: Boolean(session?.id && session?.email),
  });

  const rows = eventsQuery.data?.rows ?? emptyRows;
  const pendingCount = rows.filter((row) => !row.processed).length;
  const processedCount = rows.filter((row) => row.processed).length;

  const startNewDeclaration = (row?: EventRow) => {
    setType(row?.type ?? "BIRTH");
    setEventDate(new Date().toISOString().slice(0, 10));
    setChildBirthDate(new Date().toISOString().slice(0, 10));
    setOtherEventType("");
    setComment(row?.description ?? "");
    setFile(null);
    setFileInputKey((value) => value + 1);
    setOpen(true);
  };

  const createEvent = useMutation({
    mutationFn: async () => {
      if (!session)
        throw new Error("Session utilisateur introuvable. Reconnectez-vous puis réessayez.");
      const trimmedOtherEventType = otherEventType.trim();
      if (type === "OTHER" && !trimmedOtherEventType) {
        throw new Error("Précisez le type d'événement.");
      }
      const description =
        type === "OTHER"
          ? [trimmedOtherEventType, comment.trim()].filter(Boolean).join(" - ")
          : comment.trim();

      const form = new FormData();
      form.append("userId", session.id);
      form.append("userEmail", session.email);
      form.append("type", type);
      form.append("eventDate", eventDate);
      if (type === "BIRTH") form.append("childBirthDate", childBirthDate);
      form.append("description", description);
      if (file) form.append("proof", file, file.name);

      return apiFetch<EventRow>("/employee/events", { method: "POST", body: form });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      setOpen(false);
      setType("BIRTH");
      setEventDate(new Date().toISOString().slice(0, 10));
      setChildBirthDate(new Date().toISOString().slice(0, 10));
      setOtherEventType("");
      setComment("");
      setFile(null);
      setFileInputKey((value) => value + 1);
      toast.success("Déclaration envoyée à la RH");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <AppShell title="Déclarer un événement" subtitle="Suivi des déclarations transmises à la RH">
      <DateRangeFilter value={dateRange} onChange={setDateRange} className="mb-4" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Déclarations" value={rows.length} tone="blue" />
        <StatCard label="En attente RH" value={pendingCount} tone="orange" />
        <StatCard label="Traitées" value={processedCount} tone="green" />
        <StatCard
          label="Taux de traitement"
          value={rows.length ? `${Math.round((processedCount / rows.length) * 100)}%` : "0%"}
          tone="purple"
        />
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Mes déclarations"
          action={
            <Button onClick={() => startNewDeclaration()} disabled={!ready || !session}>
              <Plus className="size-4" /> Nouvelle déclaration
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Événement</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Justificatif</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Commentaire</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {eventsQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    Chargement des déclarations...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    Aucune déclaration enregistrée.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium">{row.typeLabel}</td>
                    <td className="px-5 py-3">{row.eventDate}</td>
                    <td className="px-5 py-3">{row.hasProof ? "Oui" : "Non"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{row.description || "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="outline" onClick={() => startNewDeclaration(row)}>
                        Déclarer
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Nouvelle déclaration</DialogTitle>
            <DialogDescription>
              La déclaration sera transmise à la RH avec le justificatif si nécessaire.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              createEvent.mutate();
            }}
          >
            <Field label="Type d'événement">
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setType(nextType);
                  if (nextType !== "BIRTH") {
                    setChildBirthDate(new Date().toISOString().slice(0, 10));
                  }
                  if (nextType !== "OTHER") {
                    setOtherEventType("");
                  }
                }}
              >
                <option value="BIRTH">Naissance / enfant</option>
                <option value="MARRIAGE">Mariage</option>
                <option value="DEATH">Décès</option>
                <option value="ILLNESS">Maladie</option>
                <option value="OTHER">Autre</option>
              </select>
            </Field>
            {type === "OTHER" && (
              <Field label="Autre type d'événement">
                <input
                  type="text"
                  aria-label="Autre type d'événement"
                  value={otherEventType}
                  onChange={(event) => setOtherEventType(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  maxLength={120}
                  required
                />
              </Field>
            )}
            <Field label="Date de déclaration">
              <div className="relative">
                <input
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm"
                />
                <Calendar className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </Field>
            {type === "BIRTH" && (
              <Field label="Date de naissance de l'enfant">
                <div className="relative">
                  <input
                    type="date"
                    value={childBirthDate}
                    onChange={(event) => setChildBirthDate(event.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm"
                    required
                  />
                  <Calendar className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                </div>
              </Field>
            )}
            <Field label="Commentaire (optionnel)">
              <textarea
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Justificatif">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border-2 border-dashed px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:bg-muted/40">
                <Paperclip className="size-4" />
                <span className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
                  Choisir un justificatif
                </span>
                <input
                  key={fileInputKey}
                  type="file"
                  accept="image/*"
                  aria-label="Choisir un justificatif"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                {file ? (
                  <span className="min-w-0 truncate">{file.name}</span>
                ) : (
                  <span>Aucun fichier</span>
                )}
              </label>
            </Field>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createEvent.isPending || !ready || !session}>
                <FileText className="size-4" />{" "}
                {createEvent.isPending ? "Envoi..." : "Soumettre à la RH"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
