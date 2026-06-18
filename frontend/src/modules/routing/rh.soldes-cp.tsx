import { createFileRoute } from "@tanstack/react-router";
import { RhLeaveBalancesPage } from "@/modules/rh/leave-balances/leave-balances.page";

export const Route = createFileRoute("/rh/soldes-cp")({
  component: RhLeaveBalancesPage,
  head: () => ({ meta: [{ title: "Import soldes CP - Conges upOwa" }] }),
});
