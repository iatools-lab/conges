import { createFileRoute } from "@tanstack/react-router";
import { AccountSettingsPage } from "@/modules/account/account.page";

export const Route = createFileRoute("/parametres")({
  component: () => (
    <AccountSettingsPage title="Paramètres" subtitle="Préférences personnelles du compte" />
  ),
  head: () => ({ meta: [{ title: "Paramètres · Conges upOwa" }] }),
});
