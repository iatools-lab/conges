import { createFileRoute } from "@tanstack/react-router";
import { Roles } from "@/modules/admin/roles/roles.page";

export const Route = createFileRoute("/admin/roles")({
  component: Roles,
  head: () => ({ meta: [{ title: "Rôles & permissions · Conges upOwa" }] }),
});
