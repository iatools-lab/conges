import { createFileRoute } from "@tanstack/react-router";
import { AccountProfilePage } from "@/modules/account/account.page";

export const Route = createFileRoute("/manager/profil")({
  component: () => (
    <AccountProfilePage
      title="Profil manager"
      subtitle="Vos informations et votre périmètre d'encadrement"
      roleScope="manager"
    />
  ),
  head: () => ({ meta: [{ title: "Profil manager · Conges upOwa" }] }),
});