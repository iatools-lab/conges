import { createFileRoute } from "@tanstack/react-router";
import { ManagerDemandes } from "@/modules/manager/requests/requests.page";

export const Route = createFileRoute("/manager/demandes")({
  component: ManagerDemandes,
  head: () => ({ meta: [{ title: "Demandes & Planifications · Manager" }] }),
});
