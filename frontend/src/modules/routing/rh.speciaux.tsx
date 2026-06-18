import { createFileRoute } from "@tanstack/react-router";
import { Speciaux } from "@/modules/rh/special-leaves/special-leaves.page";

export const Route = createFileRoute("/rh/speciaux")({
  component: Speciaux,
  head: () => ({ meta: [{ title: "Congés spéciaux (RH) · Conges upOwa" }] }),
});
