import { createFileRoute } from "@tanstack/react-router";
import { Demandes } from "@/modules/employee/leave-requests/leave-requests.page";

export const Route = createFileRoute("/demandes")({
  component: Demandes,
  head: () => ({ meta: [{ title: "Calendrier équipe · Conges upOwa" }] }),
});
