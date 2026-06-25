import { useEffect, useState } from "react";

export type AppRole = "employee" | "manager" | "rh" | "admin";

export type AuthSession = {
  id: string;
  matricule: string;
  email: string;
  name: string;
  poste: string;
  department: { id: string; code: string; name: string } | null;
  roles: AppRole[];
  primaryRole: AppRole;
  homePath: string;
  token?: string;
  expiresAt?: string;
};

export const AUTH_SESSION_KEY = "upowa.auth.session";

export function isAuthSessionExpired(session: Pick<AuthSession, "expiresAt"> | null | undefined) {
  if (!session?.expiresAt) return false;

  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function getAuthSession(): AuthSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as AuthSession;
    if (isAuthSessionExpired(session)) {
      window.localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }

    return session;
  } catch {
    window.localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

export function saveAuthSession(session: AuthSession) {
  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event("upowa-auth-session"));
}

export function clearAuthSession() {
  window.localStorage.removeItem(AUTH_SESSION_KEY);
  window.dispatchEvent(new Event("upowa-auth-session"));
}

export function useAuthSession() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    const sync = () => setSession(getAuthSession());

    sync();
    setReady(true);
    window.addEventListener("storage", sync);
    window.addEventListener("upowa-auth-session", sync);

    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("upowa-auth-session", sync);
    };
  }, []);

  useEffect(() => {
    if (!session?.expiresAt) return;

    const expiresIn = Date.parse(session.expiresAt) - Date.now();
    if (!Number.isFinite(expiresIn)) return;

    if (expiresIn <= 0) {
      clearAuthSession();
      return;
    }

    const timeout = window.setTimeout(() => {
      clearAuthSession();
    }, expiresIn);

    return () => window.clearTimeout(timeout);
  }, [session?.expiresAt]);

  return { ready, session };
}

export function getRoleLabel(role: AppRole) {
  const labels: Record<AppRole, string> = {
    admin: "Administrateur",
    rh: "Ressources Humaines",
    manager: "Manager",
    employee: "Employé",
  };

  return labels[role];
}

export function getProfilePath(role: AppRole) {
  const paths: Record<AppRole, string> = {
    admin: "/admin/profil",
    rh: "/rh/profil",
    manager: "/manager/profil",
    employee: "/profil",
  };

  return paths[role];
}

export function getSettingsPath(role: AppRole) {
  const paths: Record<AppRole, string> = {
    admin: "/admin/parametres",
    rh: "/rh/parametres",
    manager: "/manager/parametres",
    employee: "/parametres",
  };

  return paths[role];
}

export function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}

const personalPaths = new Set([
  "/",
  "/solde",
  "/planifier",
  "/demandes",
  "/historique",
  "/declarer",
  "/profil",
  "/parametres",
]);

const disabledPaths = new Set([
  "/heures-supp",
  "/manager/heures-supp",
  "/rh/heures-supp",
  "/admin/roles",
  "/admin/workflows",
]);

function normalizePath(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/$/, "");
}

function hasAnyRole(session: AuthSession, roles: AppRole[]) {
  return roles.some((role) => session.roles.includes(role));
}

export function canAccessPath(session: AuthSession, pathname: string) {
  const path = normalizePath(pathname);

  if (disabledPaths.has(path)) return false;
  if (path.startsWith("/admin")) return session.roles.includes("admin");
  if (path.startsWith("/rh")) return session.roles.includes("rh");
  if (path.startsWith("/manager")) return session.roles.includes("manager");
  if (personalPaths.has(path)) return hasAnyRole(session, ["employee", "manager", "rh"]);

  return true;
}
