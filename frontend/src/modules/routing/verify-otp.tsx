import { createFileRoute } from "@tanstack/react-router";
import { VerifyOtp } from "@/modules/auth/verify-otp/verify-otp.page";

export const Route = createFileRoute("/verify-otp")({
  component: VerifyOtp,
  head: () => ({ meta: [{ title: "Vérification · Conges upOwa" }] }),
});