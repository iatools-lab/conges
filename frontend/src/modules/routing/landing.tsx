import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/modules/auth/landing/landing.page";

export const Route = createFileRoute("/landing")({
  component: Landing,
  head: () => ({ meta: [{ title: "Aperçu · Conges upOwa" }] }),
});
