import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Shield, User } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card } from "@/components/ui-kit";
import { getRoleLabel, getInitials, useAuthSession, type AppRole } from "@/modules/auth/session";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useLocation, useRouter } from "@tanstack/react-router";

type AccountPageProps = {
  title: string;
  subtitle: string;
  roleScope?: AppRole;
};

type HierarchyPerson = {
  id: string;
  name: string;
  email: string;
  poste: string;
};

type AccountProfileResponse = {
  id: string;
  matricule: string;
  email: string;
  name: string;
  poste: string;
  department: { id: string; code: string; name: string } | null;
  departmentHead: HierarchyPerson | null;
  hierarchy: {
    n1: HierarchyPerson | null;
    n2: HierarchyPerson | null;
    n3: HierarchyPerson | null;
  };
};

function PreferenceToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
      <div>
        <div className="font-medium">{label}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 rounded border-input"
      />
    </label>
  );
}

export function AccountProfilePage({ title, subtitle, roleScope }: AccountPageProps) {
  const { session } = useAuthSession();
  const router = useRouter();
  const { pathname } = useLocation();
  const profileQuery = useQuery({
    enabled: !!session,
    queryKey: ["account-profile", session?.id, session?.email],
    queryFn: () =>
      apiFetch<AccountProfileResponse>(
        `/auth/profile?userId=${encodeURIComponent(session!.id)}&userEmail=${encodeURIComponent(
          session!.email,
        )}`,
      ),
  });

  const visibleRoles = useMemo(() => {
    if (!session) return [];
    if (roleScope) return session.roles.filter((role) => role === roleScope);
    return session.roles;
  }, [roleScope, session]);

  if (!session) return null;

  const profileData = profileQuery.data;
  const chain = profileData?.hierarchy;
  const departmentHead = profileData?.departmentHead;
  const canSwitchManager = session.roles.includes("manager") && session.roles.includes("employee");
  const switchTarget = pathname.startsWith("/manager") ? "/" : "/manager";
  const switchLabel = pathname.startsWith("/manager")
    ? "Basculer vers mon espace personnel"
    : "Basculer vers mon espace manager";

  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="size-16 rounded-2xl bg-gradient-to-br from-stat-orange-fg to-stat-red-fg text-white flex items-center justify-center text-xl font-bold">
              {getInitials(session.name)}
            </div>
            <div>
              <div className="text-xl font-semibold">{session.name}</div>
              <div className="text-sm text-muted-foreground">{session.email}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="info">{getRoleLabel(session.primaryRole)}</Badge>
                {visibleRoles.map((role) => (
                  <Badge key={role} tone="neutral">
                    {getRoleLabel(role)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3 text-sm">
            {canSwitchManager && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  router.navigate({ to: switchTarget });
                }}
              >
                {switchLabel}
              </Button>
            )}
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
              <span className="text-muted-foreground">Matricule</span>
              <span className="font-medium">{session.matricule}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
              <span className="text-muted-foreground">Poste</span>
              <span className="font-medium text-right">{profileData?.poste ?? session.poste}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
              <span className="text-muted-foreground">Département</span>
              <span className="font-medium text-right">
                {profileData?.department?.name ?? session.department?.name ?? "Non affecté"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
              <span className="text-muted-foreground">Chef de département / pôle</span>
              <span className="font-medium text-right">{departmentHead?.name ?? "Non défini"}</span>
            </div>
          </div>
        </Card>

        <div className="grid gap-6">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <User className="size-5 text-stat-blue-fg" />
              <div>
                <h3 className="font-semibold">Informations du compte</h3>
                <p className="text-sm text-muted-foreground">
                  Les informations affichées proviennent de votre session active.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Nom complet
                </div>
                <div className="mt-2 font-medium">{profileData?.name ?? session.name}</div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Email</div>
                <div className="mt-2 font-medium break-all">
                  {profileData?.email ?? session.email}
                </div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Rôle principal
                </div>
                <div className="mt-2 font-medium">{getRoleLabel(session.primaryRole)}</div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Espace</div>
                <div className="mt-2 font-medium">
                  {roleScope ? getRoleLabel(roleScope) : getRoleLabel(session.primaryRole)}
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">N+1</div>
                <div className="mt-2 font-medium">{chain?.n1?.name ?? "Non défini"}</div>
                <div className="text-xs text-muted-foreground mt-1">{chain?.n1?.poste ?? ""}</div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">N+2</div>
                <div className="mt-2 font-medium">{chain?.n2?.name ?? "Non défini"}</div>
                <div className="text-xs text-muted-foreground mt-1">{chain?.n2?.poste ?? ""}</div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">N+3</div>
                <div className="mt-2 font-medium">{chain?.n3?.name ?? "Non défini"}</div>
                <div className="text-xs text-muted-foreground mt-1">{chain?.n3?.poste ?? ""}</div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <Shield className="size-5 text-stat-blue-fg" />
              <div>
                <h3 className="font-semibold">Sécurité</h3>
                <p className="text-sm text-muted-foreground">
                  Cette section servira plus tard à connecter le profil à l'authentification.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="valid">Session active</Badge>
              <Badge tone="neutral">Accès sécurisé</Badge>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

export function AccountSettingsPage({ title, subtitle }: AccountPageProps) {
  const { session } = useAuthSession();
  const router = useRouter();
  const { pathname } = useLocation();
  const storageKey = session ? `upowa.account.settings.${session.id}` : null;
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);
  const [compactMode, setCompactMode] = useState(false);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as {
        emailAlerts?: boolean;
        dailyDigest?: boolean;
        compactMode?: boolean;
      };
      setEmailAlerts(parsed.emailAlerts ?? true);
      setDailyDigest(parsed.dailyDigest ?? false);
      setCompactMode(parsed.compactMode ?? false);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  const save = () => {
    if (!storageKey || typeof window === "undefined") return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ emailAlerts, dailyDigest, compactMode }),
    );
    toast.success("Préférences enregistrées");
  };

  if (!session) return null;

  const canSwitchManager = session.roles.includes("manager") && session.roles.includes("employee");
  const switchTarget = pathname.startsWith("/manager") ? "/" : "/manager";
  const switchLabel = pathname.startsWith("/manager")
    ? "Basculer vers mon espace personnel"
    : "Basculer vers mon espace manager";

  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <Bell className="size-5 text-stat-blue-fg" />
            <div>
              <h3 className="font-semibold">Préférences du compte</h3>
              <p className="text-sm text-muted-foreground">
                Réglages personnels conservés localement pour cette session.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {canSwitchManager && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  router.navigate({ to: switchTarget });
                }}
              >
                {switchLabel}
              </Button>
            )}
            <PreferenceToggle
              label="Alertes e-mail"
              description="Recevoir les notifications importantes par courriel."
              checked={emailAlerts}
              onChange={setEmailAlerts}
            />
            <PreferenceToggle
              label="Résumé quotidien"
              description="Recevoir un récapitulatif automatique chaque jour."
              checked={dailyDigest}
              onChange={setDailyDigest}
            />
            <PreferenceToggle
              label="Affichage compact"
              description="Réduire les espacements dans l'interface."
              checked={compactMode}
              onChange={setCompactMode}
            />
          </div>
          <Button className="mt-5 w-full" onClick={save}>
            <Check className="size-4" />
            Enregistrer
          </Button>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <User className="size-5 text-stat-blue-fg" />
            <div>
              <h3 className="font-semibold">Compte connecté</h3>
              <p className="text-sm text-muted-foreground">
                Ces paramètres s'appliquent à {session.name}.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Nom</div>
              <div className="mt-2 font-medium">{session.name}</div>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Email</div>
              <div className="mt-2 font-medium break-all">{session.email}</div>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Matricule</div>
              <div className="mt-2 font-medium">{session.matricule}</div>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Poste</div>
              <div className="mt-2 font-medium">{session.poste}</div>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
