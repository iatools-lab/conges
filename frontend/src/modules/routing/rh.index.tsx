import { createFileRoute } from "@tanstack/react-router";
import { RhDashboard } from "@/modules/rh/dashboard/dashboard.page";

export const Route = createFileRoute("/rh/")({
  component: RhDashboard,
  head: () => ({ meta: [{ title: "Tableau de bord RH · Conges upOwa" }] }),
});
