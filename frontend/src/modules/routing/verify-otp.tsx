import { createFileRoute, redirect } from "@tanstack/react-router";
import { AUTH_GOOGLE_ONLY } from "@/modules/auth/config";
import { VerifyOtp } from "@/modules/auth/verify-otp/verify-otp.page";

export const Route = createFileRoute("/verify-otp")({
  beforeLoad: () => {
    if (AUTH_GOOGLE_ONLY) throw redirect({ to: "/login" });
  },
  component: VerifyOtp,
  head: () => ({ meta: [{ title: "Vérification · Conges upOwa" }] }),
});
