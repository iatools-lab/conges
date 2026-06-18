import { createFileRoute } from "@tanstack/react-router";
import { AccountSettingsPage } from "@/modules/account/account.page";

export const Route = createFileRoute("/manager/parametres")({
  component: () => (
    <AccountSettingsPage
      title="Paramètres manager"
      subtitle="Préférences de votre espace de validation"
    />
  ),
  head: () => ({ meta: [{ title: "Paramètres manager · Conges upOwa" }] }),
});