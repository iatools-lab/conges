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
import { RowActions } from "@/components/RowActions";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Eye, FileText, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

type EventStatusTone = "valid" | "pending" | "rejected";

type EventRow = {
  id: string;
  type: string;
  typeLabel: string;
  eventDate: string;
  eventDateInput?: string;
  createdAt: string;
  description: string;
  hasProof: boolean;
  processed: boolean;
  statusCode: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "CANCELLED";
  statusLabel: string;
  statusTone: EventStatusTone;
  rhComment: string;
  proofUrl?: string;
};

type EventTypeOption = {
  id: string;
  value: string;
  label: string;
  code?: string;
  days?: number;
};

type EventsResponse = {
  eventTypes?: EventTypeOption[];
  rows: EventRow[];
};

const emptyRows: EventRow[] = [];
const defaultEventTypes: EventTypeOption[] = [
  {
    id: "leave-type:MAR_TRAV",
    value: "MARRIAGE",
    label: "Mariage du travailleur (4 jours)",
    code: "MAR_TRAV",
    days: 4,
  },
  {
    id: "leave-type:PAT",
    value: "BIRTH",
    label: "Congé paternité (3 jours)",
    code: "PAT",
    days: 3,
  },
  {
    id: "leave-type:BAP_ENF",
    value: "OTHER",
    label: "Baptême d'un enfant du travailleur (1 jour)",
    code: "BAP_ENF",
    days: 1,
  },
  {
    id: "leave-type:MAR_ENF",
    value: "MARRIAGE",
    label: "Mariage d'un enfant du travailleur (2 jours)",
    code: "MAR_ENF",
    days: 2,
  },
  {
    id: "leave-type:DEC_CONJ",
    value: "DEATH",
    label: "Décès du conjoint du travailleur (5 jours)",
    code: "DEC_CONJ",
    days: 5,
  },
  {
    id: "leave-type:DEC_ENF",
    value: "DEATH",
    label: "Décès d'un enfant du travailleur (3 jours)",
    code: "DEC_ENF",
    days: 3,
  },
  {
    id: "leave-type:DEC_PARENT",
    value: "DEATH",
    label: "Décès du père ou de la mère du travailleur (5 jours)",
    code: "DEC_PARENT",
    days: 5,
  },
  {
    id: "leave-type:DEC_PARENT_CONJ",
    value: "DEATH",
    label: "Décès du père ou de la mère du conjoint légitime (3 jours)",
    code: "DEC_PARENT_CONJ",
    days: 3,
  },
  {
    id: "leave-type:DEC_FRERE_SOEUR",
    value: "DEATH",
    label: "Décès du frère ou de la sœur du travailleur (3 jours)",
    code: "DEC_FRERE_SOEUR",
    days: 3,
  },
];

function buildEventsPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
    limit: "50",
  });
  appendDateRange(params, range);

  return `/employee/events?${params.toString()}`;
}

function eventTypeOptionForRow(row: EventRow | undefined, eventTypes: EventTypeOption[]) {
  if (!row) return eventTypes[0]?.id ?? "leave-type:MAR_TRAV";

  const codeMatch = row.description.match(/\[([A-Z0-9_]+)\]/);
  if (codeMatch) {
    const normalizedCode = codeMatch[1] === "ACC_EPOUSE" ? "PAT" : codeMatch[1];
    const byCode = eventTypes.find((option) => option.code === normalizedCode);
    if (byCode) return byCode.id;
  }

  return (
    eventTypes.find((option) => option.value === row.type)?.id ??
    eventTypes[0]?.id ??
    "leave-type:MAR_TRAV"
  );
}

function commentForRow(row: EventRow | undefined) {
  if (!row?.description) return "";

  return row.description
    .replace(/^\[[A-Z0-9_]+\]\s*-\s*/, "")
    .replace(/^.+?\(\d+\s+jours?\)\s*-\s*/, "")
    .trim();
}

export function Declarer() {
  const { ready, session } = useAuthSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
  const [detailEvent, setDetailEvent] = useState<EventRow | null>(null);
  const [eventTypeOptionId, setEventTypeOptionId] = useState("leave-type:MAR_TRAV");
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
  const eventTypes = eventsQuery.data?.eventTypes?.length
    ? eventsQuery.data.eventTypes
    : defaultEventTypes.filter((option) => option.code);
  const selectedEventTypeOption =
    eventTypes.find((option) => option.id === eventTypeOptionId) ?? eventTypes[0];
  const type = selectedEventTypeOption?.value ?? "BIRTH";
  const pendingCount = rows.filter(
    (row) => row.statusCode === "PENDING" || row.statusCode === "IN_REVIEW",
  ).length;
  const processedCount = rows.filter(
    (row) => row.statusCode === "APPROVED" || row.statusCode === "REJECTED",
  ).length;

  const startNewDeclaration = (row?: EventRow) => {
    setEventTypeOptionId(eventTypeOptionForRow(row, eventTypes));
    setEventDate(row?.eventDateInput ?? new Date().toISOString().slice(0, 10));
    setChildBirthDate(row?.eventDateInput ?? new Date().toISOString().slice(0, 10));
    setOtherEventType("");
    setComment(commentForRow(row));
    setFile(null);
    setFileInputKey((value) => value + 1);
    setEditingEvent(row ?? null);
    setOpen(true);
  };

  const closeDeclarationDialog = () => {
    setOpen(false);
    setEditingEvent(null);
  };

  const saveEvent = useMutation({
    mutationFn: async () => {
      if (!session)
        throw new Error("Session utilisateur introuvable. Reconnectez-vous puis réessayez.");
      const trimmedOtherEventType = otherEventType.trim();
      if (type === "OTHER" && !selectedEventTypeOption?.code && !trimmedOtherEventType) {
        throw new Error("Précisez le type d'événement.");
      }
      const description =
        selectedEventTypeOption?.code || selectedEventTypeOption?.label
          ? [
              selectedEventTypeOption.code ? `[${selectedEventTypeOption.code}]` : "",
              selectedEventTypeOption.label,
              comment.trim(),
            ]
              .filter(Boolean)
              .join(" - ")
          : type === "OTHER"
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

      return apiFetch<EventRow>(
        editingEvent ? `/employee/events/${editingEvent.id}` : "/employee/events",
        {
          method: editingEvent ? "PATCH" : "POST",
          body: form,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      setOpen(false);
      setEditingEvent(null);
      setEventTypeOptionId(eventTypes[0]?.id ?? "leave-type:MAR_TRAV");
      setEventDate(new Date().toISOString().slice(0, 10));
      setChildBirthDate(new Date().toISOString().slice(0, 10));
      setOtherEventType("");
      setComment("");
      setFile(null);
      setFileInputKey((value) => value + 1);
      toast.success(editingEvent ? "Déclaration mise à jour" : "Déclaration envoyée à la RH");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteEvent = useMutation({
    mutationFn: (row: EventRow) => {
      if (!session)
        throw new Error("Session utilisateur introuvable. Reconnectez-vous puis réessayez.");
      return apiFetch<{ id: string; deleted: boolean }>(`/employee/events/${row.id}`, {
        method: "DELETE",
        body: JSON.stringify({ userId: session.id, userEmail: session.email }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      toast.success("Déclaration supprimée");
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
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Événement</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Justificatif</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Ma description</th>
                <th className="px-5 py-3">Commentaire RH</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {eventsQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                    Chargement des déclarations...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
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
                    <td className="px-5 py-3 text-muted-foreground">{row.rhComment || "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <RowActions
                        label="la déclaration"
                        actions={[
                          {
                            label: "Voir",
                            icon: Eye,
                            onSelect: () => setDetailEvent(row),
                          },
                          {
                            label: "Modifier",
                            icon: Pencil,
                            disabled:
                              row.statusCode === "APPROVED" || row.statusCode === "IN_REVIEW",
                            onSelect: () => startNewDeclaration(row),
                          },
                          {
                            label: "Supprimer",
                            icon: Trash2,
                            destructive: true,
                            disabled:
                              row.statusCode === "APPROVED" ||
                              row.statusCode === "IN_REVIEW" ||
                              deleteEvent.isPending,
                            onSelect: () => deleteEvent.mutate(row),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={Boolean(detailEvent)}
        onOpenChange={(nextOpen) => !nextOpen && setDetailEvent(null)}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Détail de la déclaration</DialogTitle>
            <DialogDescription>Informations transmises à la RH.</DialogDescription>
          </DialogHeader>
          {detailEvent && (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Événement" value={detailEvent.typeLabel} />
              <Detail label="Date" value={detailEvent.eventDate} />
              <Detail label="Statut" value={detailEvent.statusLabel} />
              <Detail label="Créée le" value={detailEvent.createdAt} />
              <Detail label="Description" value={detailEvent.description || "—"} wide />
              <Detail label="Commentaire RH" value={detailEvent.rhComment || "—"} wide />
              <Detail
                label="Justificatif"
                value={
                  detailEvent.proofUrl ? (
                    <a
                      href={detailEvent.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Ouvrir le fichier
                    </a>
                  ) : (
                    "Aucun justificatif"
                  )
                }
                wide
              />
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailEvent(null)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : closeDeclarationDialog())}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {editingEvent ? "Modifier la déclaration" : "Nouvelle déclaration"}
            </DialogTitle>
            <DialogDescription>
              La déclaration sera transmise à la RH avec le justificatif si nécessaire.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              saveEvent.mutate();
            }}
          >
            <Field label="Type d'événement">
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedEventTypeOption?.id ?? "leave-type:MAR_TRAV"}
                onChange={(event) => {
                  const nextOptionId = event.target.value;
                  const nextType =
                    eventTypes.find((option) => option.id === nextOptionId)?.value ?? "BIRTH";
                  setEventTypeOptionId(nextOptionId);
                  if (nextType !== "BIRTH") {
                    setChildBirthDate(new Date().toISOString().slice(0, 10));
                  }
                  if (nextType !== "OTHER") {
                    setOtherEventType("");
                  }
                }}
              >
                {eventTypes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            {type === "OTHER" && !selectedEventTypeOption?.code && (
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
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
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
              <div className="mt-1 text-xs text-muted-foreground">Image ou PDF, 3 Mo maximum.</div>
            </Field>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={closeDeclarationDialog}>
                Annuler
              </Button>
              <Button type="submit" disabled={saveEvent.isPending || !ready || !session}>
                <FileText className="size-4" />{" "}
                {saveEvent.isPending
                  ? "Envoi..."
                  : editingEvent
                    ? "Enregistrer et renvoyer RH"
                    : "Soumettre à la RH"}
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

function Detail({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  );
}
