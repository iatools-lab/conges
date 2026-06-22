import { createFileRoute } from "@tanstack/react-router";
import { AccountProfilePage } from "@/modules/account/account.page";

export const Route = createFileRoute("/profil")({
  component: () => (
    <AccountProfilePage
      title="Mon profil"
      subtitle="Vos informations personnelles et votre espace"
    />
  ),
  head: () => ({ meta: [{ title: "Mon profil · Conges upOwa" }] }),
});
