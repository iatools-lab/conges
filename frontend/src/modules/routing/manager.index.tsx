import { createFileRoute } from "@tanstack/react-router";
import { ManagerDashboard } from "@/modules/manager/dashboard/dashboard.page";

export const Route = createFileRoute("/manager/")({
  component: ManagerDashboard,
  head: () => ({ meta: [{ title: "Tableau de bord Manager · Conges upOwa" }] }),
});
