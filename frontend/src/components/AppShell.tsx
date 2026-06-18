import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, User, LogOut, CheckCheck, ChevronDown, Menu, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { pickNavigation, type NavigationGroup } from "@/modules/navigation";
import { toast } from "sonner";
import {
  canAccessPath,
  clearAuthSession,
  getInitials,
  getRoleLabel,
  getProfilePath,
  getSettingsPath,
  type AppRole,
  useAuthSession,
  type AuthSession,
} from "@/modules/auth/session";
import { apiFetch } from "@/lib/api";

function GroupBlock({
  group,
  pathname,
  onNavigate,
}: {
  group: NavigationGroup;
  pathname: string;
  onNavigate?: () => void;
}) {
  const containsActive = useMemo(
    () => group.items.some((i) => i.to === pathname),
    [group.items, pathname],
  );
  const [open, setOpen] = useState(containsActive);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[11px] uppercase tracking-wider text-white/55 hover:text-white hover:bg-white/5 transition-colors"
      >
        <span className="text-white/70">{group.icon}</span>
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="mt-0.5 mb-1 ml-2 pl-2 border-l border-white/10 space-y-0.5">
          {group.items.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to + item.label}
                to={item.to}
                onClick={onNavigate}
                className={`flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SidebarInner({
  pathname,
  session,
  onNavigate,
}: {
  pathname: string;
  session: AuthSession;
  onNavigate?: () => void;
}) {
  const { groups, flat, section } = pickNavigation(pathname);
  return (
    <div className="flex flex-col h-full bg-navy text-navy-foreground">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10 shrink-0">
        <div className="size-9 rounded-lg bg-white/10 flex items-center justify-center font-bold">
          C
        </div>
        <div>
          <div className="font-semibold leading-tight">Conges upOwa</div>
          <div className="text-[11px] text-white/60">{section}</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {flat &&
          flat.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        {groups &&
          groups.map((g) => (
            <GroupBlock key={g.id} group={g} pathname={pathname} onNavigate={onNavigate} />
          ))}
      </nav>
      <div className="px-4 py-3 space-y-3 border-t border-white/10 shrink-0">
        <SidebarSwitchButton pathname={pathname} session={session} onNavigate={onNavigate} />
        <div className="text-[11px] text-white/40">© 2026 Conges upOwa</div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { session } = useAuthSession();
  const { pathname } = useLocation();
  if (!session) return null;
  return (
    <aside className="hidden lg:flex w-60 shrink-0 sticky top-0 h-screen self-start">
      <SidebarInner pathname={pathname} session={session} />
    </aside>
  );
}

function MobileSidebar() {
  const { session } = useAuthSession();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  if (!session) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="lg:hidden p-2 rounded-md hover:bg-accent cursor-pointer"
          aria-label="Ouvrir le menu"
        >
          <Menu className="size-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64 bg-navy border-r-0 text-navy-foreground">
        <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
        <SidebarInner pathname={pathname} session={session} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

type Notif = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

type NotificationsResponse = {
  unread: number;
  rows: Notif[];
};

const emptyNotifications: Notif[] = [];

function buildNotificationsPath(session: AuthSession) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
    limit: "10",
  });

  return `/notifications?${params.toString()}`;
}

function notificationOwner(session: AuthSession) {
  return { userId: session.id, userEmail: session.email };
}

function formatRelativeTime(value: string) {
  const createdAt = new Date(value).getTime();
  const diffMs = Date.now() - createdAt;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) return "à l'instant";
  if (diffMinutes < 60) return `il y a ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "hier";
  return `il y a ${diffDays} j`;
}

function getProfile(session: AuthSession) {
  const roleLabel = formatSessionRoles(session);

  return {
    name: session.name,
    role: session.department?.name ? `${roleLabel} · ${session.department.name}` : roleLabel,
    initials: getInitials(session.name),
  };
}

function formatSessionRoles(session: AuthSession) {
  const orderedRoles: AppRole[] = ["admin", "rh", "manager", "employee"];
  const labels = orderedRoles
    .filter((role) => session.roles.includes(role))
    .map((role) => getRoleLabel(role));

  return labels.length > 0 ? labels.join(", ") : getRoleLabel(session.primaryRole);
}

function getSpacePaths(session: AuthSession) {
  return {
    profile: getProfilePath(session.primaryRole),
    settings: getSettingsPath(session.primaryRole),
  };
}

function getRoleHomePath(role: AppRole) {
  const paths: Record<AppRole, string> = {
    admin: "/admin/users",
    rh: "/rh",
    manager: "/manager",
    employee: "/",
  };
  return paths[role];
}

function getSpaceSwitch(session: AuthSession, pathname: string) {
  const spaces = getAvailableSpaces(session);
  if (spaces.length <= 1) return null;

  const currentSpace = getCurrentSpace(pathname);
  const currentIndex = currentSpace ? spaces.indexOf(currentSpace) : -1;
  const nextSpace = spaces[(currentIndex + 1) % spaces.length] ?? spaces[0];

  return { to: getRoleHomePath(nextSpace), label: getSpaceSwitchLabel(nextSpace) };
}

function getCurrentSpace(pathname: string): AppRole {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/rh")) return "rh";
  if (pathname.startsWith("/manager")) return "manager";
  return "employee";
}

function getAvailableSpaces(session: AuthSession) {
  const spaces: AppRole[] = [];
  if (session.roles.includes("admin")) spaces.push("admin");
  if (session.roles.includes("rh")) spaces.push("rh");
  if (session.roles.includes("manager")) spaces.push("manager");
  if (session.roles.some((role) => ["employee", "manager", "rh"].includes(role))) {
    spaces.push("employee");
  }

  return spaces;
}

function getSpaceSwitchLabel(role: AppRole) {
  const labels: Record<AppRole, string> = {
    admin: "Espace administrateur",
    rh: "Espace RH",
    manager: "Espace manager",
    employee: "Espace personnel",
  };

  return labels[role];
}

function SidebarSwitchButton({
  pathname,
  session,
  onNavigate,
}: {
  pathname: string;
  session: AuthSession;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const switchTarget = getSpaceSwitch(session, pathname);

  if (!switchTarget) return null;

  return (
    <button
      onClick={() => {
        router.navigate({ to: switchTarget.to });
        onNavigate?.();
      }}
      className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors"
    >
      {switchTarget.label}
    </button>
  );
}

export function Topbar({
  title,
  subtitle,
  session,
}: {
  title: string;
  subtitle?: string;
  session: AuthSession;
}) {
  const router = useRouter();
  const profile = getProfile(session);
  const spacePaths = getSpacePaths(session);
  const queryClient = useQueryClient();
  const notificationsQueryKey = ["notifications", session.id, session.email];
  const notificationsQuery = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: () => apiFetch<NotificationsResponse>(buildNotificationsPath(session)),
    // Keep notification bell up to date even when user stays on same page.
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });
  const notifs = notificationsQuery.data?.rows ?? emptyNotifications;
  const unread = notificationsQuery.data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Notif>(`/notifications/${id}/read`, {
        method: "PATCH",
        body: JSON.stringify(notificationOwner(session)),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
    onError: (error) => toast.error(error.message),
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      apiFetch<{ updated: number }>("/notifications/read-all", {
        method: "PATCH",
        body: JSON.stringify(notificationOwner(session)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
      toast.success("Notifications marquées comme lues");
    },
    onError: (error) => toast.error(error.message),
  });

  const markAll = () => {
    markAllRead.mutate();
  };

  return (
    <header className="flex items-center justify-between gap-3 px-4 md:px-6 lg:px-8 py-3 md:py-4 bg-card border-b sticky top-0 z-30">
      <div className="flex items-center gap-2 min-w-0">
        <MobileSidebar />
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl lg:text-2xl font-semibold tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="relative p-2 rounded-md hover:bg-accent cursor-pointer"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
              {unread > 0 && (
                <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {unread}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="px-0 py-0">Notifications</DropdownMenuLabel>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <CheckCheck className="size-3" /> Tout lire
                </button>
              )}
            </div>
            <DropdownMenuSeparator />
            {notifs.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {notificationsQuery.isLoading ? "Chargement..." : "Aucune notification"}
              </div>
            )}
            {notifs.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => {
                  if (!n.read) markRead.mutate(n.id);
                  if (n.link) {
                    router.navigate({ to: n.link });
                  }
                }}
                className="flex-col items-start gap-0.5 py-2.5 cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  {!n.read && <span className="size-2 rounded-full bg-stat-blue-fg shrink-0" />}
                  <span className="font-medium text-sm">{n.title}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {formatRelativeTime(n.createdAt)}
                  </span>
                </div>
                {n.description && (
                  <span className="text-xs text-muted-foreground pl-4">{n.description}</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 p-1 md:pr-3 rounded-full hover:bg-accent cursor-pointer">
              <span className="size-9 rounded-full bg-gradient-to-br from-stat-orange-fg to-stat-red-fg text-white text-xs font-semibold flex items-center justify-center">
                {profile.initials}
              </span>
              <span className="hidden xl:flex flex-col items-start leading-tight">
                <span className="text-sm font-medium">{profile.name}</span>
                <span className="text-[11px] text-muted-foreground">{profile.role}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-medium">{profile.name}</div>
              <div className="text-[11px] text-muted-foreground font-normal">{profile.role}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                router.navigate({ to: spacePaths.profile });
              }}
            >
              <User className="size-4 mr-2" /> Mon profil
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                router.navigate({ to: spacePaths.settings });
              }}
            >
              <Settings className="size-4 mr-2" /> Paramètres
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                clearAuthSession();
                toast.success("Déconnexion");
                router.navigate({ to: "/login" });
              }}
            >
              <LogOut className="size-4 mr-2" /> Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const router = useRouter();
  const { ready, session } = useAuthSession();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.navigate({ to: "/login" });
      return;
    }
    if (!canAccessPath(session, pathname)) {
      window.location.replace(session.homePath);
    }
  }, [pathname, ready, router, session]);

  if (!ready || !session || !canAccessPath(session, pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Chargement de votre espace...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} subtitle={subtitle} session={session} />
        <main className="flex-1 px-4 md:px-6 lg:px-8 py-4 md:py-6 min-w-0 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
