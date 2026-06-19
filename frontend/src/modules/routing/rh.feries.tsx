import { createFileRoute } from "@tanstack/react-router";
import { RhFeries } from "@/modules/rh/holidays/holidays.page";

export const Route = createFileRoute("/rh/feries")({
  component: RhFeries,
  head: () => ({ meta: [{ title: "Jours fériés RH · Conges upOwa" }] }),
});
