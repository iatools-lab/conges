import { createFileRoute } from "@tanstack/react-router";
import { Login } from "@/modules/auth/login/login.page";

export const Route = createFileRoute("/login")({
  component: Login,
  head: () => ({ meta: [{ title: "Connexion · Conges upOwa" }] }),
});
