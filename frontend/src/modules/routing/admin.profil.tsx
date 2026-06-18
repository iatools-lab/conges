import { createFileRoute } from "@tanstack/react-router";
import { AccountProfilePage } from "@/modules/account/account.page";

export const Route = createFileRoute("/admin/profil")({
  component: () => (
    <AccountProfilePage
      title="Profil administrateur"
      subtitle="Votre compte et vos permissions système"
      roleScope="admin"
    />
  ),
  head: () => ({ meta: [{ title: "Profil administrateur · Conges upOwa" }] }),
});