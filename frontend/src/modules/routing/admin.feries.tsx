import { createFileRoute } from "@tanstack/react-router";
import { Feries } from "@/modules/admin/holidays/holidays.page";

export const Route = createFileRoute("/admin/feries")({
  component: Feries,
  head: () => ({ meta: [{ title: "Jours fériés · Conges upOwa" }] }),
});
