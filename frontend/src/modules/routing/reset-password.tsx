import { createFileRoute } from "@tanstack/react-router";
import { ResetPassword } from "@/modules/auth/reset-password/reset-password.page";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  head: () => ({ meta: [{ title: "Nouveau mot de passe · Conges upOwa" }] }),
});