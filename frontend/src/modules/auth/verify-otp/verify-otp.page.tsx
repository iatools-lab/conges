import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Fingerprint } from "lucide-react";
import { useState, useRef, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export function VerifyOtp() {
  const router = useRouter();
  // Récupérer l'email depuis l'URL ou localStorage
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const initialEmail = params.get("email") || "";

  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, value: string) => {
    if (value.length > 1) return; // Ne prendre qu'un seul chiffre
    if (value && !/^\d$/.test(value)) return; // Ne prendre que des chiffres

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError(null);

    // Passer au champ suivant automatiquement
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").trim();
    if (!/^\d{6}$/.test(pasted)) return;

    const digits = pasted.split("");
    setOtp(digits);
    inputRefs.current[5]?.focus();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const code = otp.join("");
    if (code.length !== 6) {
      setError("Veuillez saisir le code à 6 chiffres complet.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await apiFetch<{ message: string; resetToken: string }>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });

      // Stocker le token de reset temporaire en mémoire (pas dans localStorage)
      sessionStorage.setItem("upowa.reset.token", result.resetToken);
      sessionStorage.setItem("upowa.reset.email", email);
      sessionStorage.setItem("upowa.reset.code", code);

      toast.success("Code vérifié avec succès");
      router.navigate({ to: "/reset-password" });
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Code invalide";
      setError(message);
      toast.error(message);
      // Reset du code en cas d'erreur
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (!email) {
      toast.error("Email requis");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiFetch<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      toast.success("Nouveau code envoyé si l'email existe");
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch {
      toast.error("Erreur lors du renvoi");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md bg-card border rounded-xl p-8 shadow-sm text-center">
          <h2 className="text-xl font-semibold mb-4">Email requis</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Veuillez retourner à la page précédente et saisir votre email.
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
        <button
          type="button"
          onClick={() => router.navigate({ to: "/forgot-password" })}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-4" />
          Retour
        </button>

        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-indigo-100">
          <Fingerprint className="size-6 text-indigo-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Vérification</h2>
        <p className="text-sm text-muted-foreground mb-2">Un code à 6 chiffres a été envoyé à</p>
        <p className="text-sm font-medium mb-6">{email}</p>

        <form className="space-y-6" onSubmit={submit}>
          <div>
            <label className="block text-sm font-medium mb-3 text-center">
              Code de vérification
            </label>
            <div className="flex justify-center gap-2">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={digit}
                  onChange={(event) => handleChange(index, event.target.value)}
                  onKeyDown={(event) => handleKeyDown(index, event)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  className="size-12 rounded-md border bg-background text-center text-xl font-semibold focus:border-navy focus:ring-1 focus:ring-navy"
                  required
                  autoFocus={index === 0}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || otp.some((d) => !d)}
            className="w-full rounded-md bg-navy text-navy-foreground py-2.5 text-sm font-medium hover:bg-navy-hover disabled:opacity-60"
          >
            {isSubmitting ? "Vérification..." : "Vérifier le code"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={resendCode}
            disabled={isSubmitting}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Renvoyer le code
          </button>
        </div>
      </div>
    </div>
  );
}
