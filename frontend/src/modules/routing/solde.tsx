import { createFileRoute } from "@tanstack/react-router";
import { Solde } from "@/modules/employee/balances/balances.page";

export const Route = createFileRoute("/solde")({
  component: Solde,
  head: () => ({ meta: [{ title: "Mon solde · Conges upOwa" }] }),
});
