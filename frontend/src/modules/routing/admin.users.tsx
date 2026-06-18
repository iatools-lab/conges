import { createFileRoute } from "@tanstack/react-router";
import { Users } from "@/modules/admin/users/users.page";

export const Route = createFileRoute("/admin/users")({
  component: Users,
  head: () => ({ meta: [{ title: "Employés · Conges upOwa" }] }),
});
