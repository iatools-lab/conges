import { createFileRoute } from "@tanstack/react-router";
import { Passif } from "@/modules/rh/leave-liabilities/leave-liabilities.page";

export const Route = createFileRoute("/rh/passif")({
  component: Passif,
  head: () => ({ meta: [{ title: "Gestion du passif · Conges upOwa" }] }),
});
