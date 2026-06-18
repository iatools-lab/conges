import { useRouter } from "@tanstack/react-router";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export function ResetPassword() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Récupérer le token et l'email depuis sessionStorage
  const resetToken =
    typeof window !== "undefined" ? sessionStorage.getItem("upowa.reset.token") : null;
  const email = typeof window !== "undefined" ? sessionStorage.getItem("upowa.reset.email") : null;

  // Récupérer le code OTP depuis sessionStorage ou le forcer à resaisir
  const code = typeof window !== "undefined" ? sessionStorage.getItem("upowa.reset.code") : null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    if (!/[A-Z]/.test(newPassword)) {
      setError("Le mot de passe doit contenir au moins une majuscule.");
      return;
    }

    if (!/[a-z]/.test(newPassword)) {
      setError("Le mot de passe doit contenir au moins une minuscule.");
      return;
    }

    if (!/\d/.test(newPassword)) {
      setError("Le mot de passe doit contenir au moins un chiffre.");
      return;
    }

    setIsSubmitting(true);

    try {
      await apiFetch<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          email,
          code,
          newPassword,
        }),
        headers: resetToken ? { Authorization: `Bearer ${resetToken}` } : {},
      });

      // Nettoyer le sessionStorage
      sessionStorage.removeItem("upowa.reset.token");
      sessionStorage.removeItem("upowa.reset.email");
      sessionStorage.removeItem("upowa.reset.code");

      toast.success("Mot de passe réinitialisé avec succès !");
      router.navigate({ to: "/login" });
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : "Erreur lors de la réinitialisation";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!email || !resetToken || !code) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md bg-card border rounded-xl p-8 shadow-sm text-center">
          <h2 className="text-xl font-semibold mb-4">Session expirée</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Veuillez recommencer la procédure de réinitialisation.
          </p>
          <button
            type="button"
            onClick={() => router.navigate({ to: "/forgot-password" })}
            className="rounded-md bg-navy text-navy-foreground py-2.5 px-4 text-sm font-medium"
          >
            Mot de passe oublié
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md bg-card border rounded-xl p-8 shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-100">
          <Lock className="size-6 text-emerald-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Nouveau mot de passe</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Choisissez un mot de passe sécurisé pour votre compte.
        </p>

        <form className="space-y-4" onSubmit={submit}>
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium mb-1.5">
              Nouveau mot de passe
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Au moins 8 caractères"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
              <p className={newPassword.length >= 8 ? "text-emerald-600" : ""}>
                ✓ Au moins 8 caractères
              </p>
              <p className={/[A-Z]/.test(newPassword) ? "text-emerald-600" : ""}>
                ✓ Au moins une majuscule
              </p>
              <p className={/[a-z]/.test(newPassword) ? "text-emerald-600" : ""}>
                ✓ Au moins une minuscule
              </p>
              <p className={/\d/.test(newPassword) ? "text-emerald-600" : ""}>
                ✓ Au moins un chiffre
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium mb-1.5">
              Confirmer le mot de passe
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Répétez le mot de passe"
              required
              autoComplete="new-password"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-navy text-navy-foreground py-2.5 text-sm font-medium hover:bg-navy-hover disabled:opacity-60"
          >
            {isSubmitting ? "Réinitialisation..." : "Réinitialiser le mot de passe"}
          </button>
        </form>
      </div>
    </div>
  );
}
