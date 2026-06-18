import { createFileRoute } from "@tanstack/react-router";
import { RhEmployes } from "@/modules/rh/employees/employees.page";

export const Route = createFileRoute("/rh/employes")({
  component: RhEmployes,
  head: () => ({ meta: [{ title: "Employés · RH" }] }),
});
