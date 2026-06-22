import { createFileRoute } from "@tanstack/react-router";
import { AccountProfilePage } from "@/modules/account/account.page";

export const Route = createFileRoute("/rh/profil")({
  component: () => (
    <AccountProfilePage
      title="Profil RH"
      subtitle="Vos informations et votre périmètre de ressources humaines"
      roleScope="rh"
    />
  ),
  head: () => ({ meta: [{ title: "Profil RH · Conges upOwa" }] }),
});
