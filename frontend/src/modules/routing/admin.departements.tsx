import { createFileRoute } from "@tanstack/react-router";
import { Departements } from "@/modules/admin/departments/departments.page";

export const Route = createFileRoute("/admin/departements")({
  component: Departements,
  head: () => ({ meta: [{ title: "Départements · Conges upOwa" }] }),
});
