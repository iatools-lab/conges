import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/roles")({
  component: () => null,
  head: () => ({ meta: [{ title: "Rôles & permissions · Conges upOwa" }] }),
});
