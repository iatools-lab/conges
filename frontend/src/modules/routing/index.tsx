import { createFileRoute } from "@tanstack/react-router";
import { EmployeeDashboard } from "@/modules/employee/dashboard/dashboard.page";

export const Route = createFileRoute("/")({
  component: EmployeeDashboard,
  head: () => ({ meta: [{ title: "Tableau de bord · Conges upOwa" }] }),
});
