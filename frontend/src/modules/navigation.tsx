import type { ReactNode } from "react";
import {
  AlertCircle,
  Baby,
  BarChart3,
  Building2,
  GitBranch,
  CalendarDays,
  CalendarOff,
  CalendarCheck,
  CalendarRange,
  ClipboardCheck,
  Coins,
  Globe,
  History,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import { adminModule, employeeModule, managerModule, rhModule } from "./index";
import type { FrontendModule, FrontendSubmodule } from "./module.types";

export type NavigationItem = { to: string; label: string; icon: ReactNode };
export type NavigationGroup = {
  id: string;
  label: string;
  icon: ReactNode;
  items: NavigationItem[];
};

function findSubmodule(module: FrontendModule, id: string): FrontendSubmodule {
  const submodule = module.submodules.find((item) => item.id === id);
  if (!submodule) {
    throw new Error(`Unknown submodule ${module.id}.${id}`);
  }
  return submodule;
}

function item(module: FrontendModule, id: string, icon: ReactNode): NavigationItem {
  const submodule = findSubmodule(module, id);
  return { to: submodule.path, label: submodule.label, icon };
}

const employeeDashboard = item(employeeModule, "dashboard", <LayoutDashboard className="size-4" />);
const employeeBalances = item(employeeModule, "balances", <Wallet className="size-4" />);
const employeePlanning = item(employeeModule, "planning", <CalendarDays className="size-4" />);
const employeePermissions = item(
  employeeModule,
  "permissions",
  <CalendarCheck className="size-4" />,
);
const employeeRequests = item(
  employeeModule,
  "leave-requests",
  <CalendarRange className="size-4" />,
);
const employeeEvents = item(employeeModule, "events", <AlertCircle className="size-4" />);
const employeeHistory = item(employeeModule, "history", <History className="size-4" />);

const employeeNav: NavigationItem[] = [
  employeeDashboard,
  employeeBalances,
  employeePlanning,
  employeePermissions,
  employeeRequests,
  employeeEvents,
  employeeHistory,
];

const managerGroups: NavigationGroup[] = [
  {
    id: "pilotage",
    label: "Pilotage",
    icon: <BarChart3 className="size-4" />,
    items: [
      item(managerModule, "dashboard", <BarChart3 className="size-4" />),
      item(managerModule, "requests", <ClipboardCheck className="size-4" />),
      item(managerModule, "permissions", <CalendarCheck className="size-4" />),
      item(managerModule, "conflicts", <AlertCircle className="size-4" />),
      item(managerModule, "calendar", <Globe className="size-4" />),
      item(managerModule, "history", <History className="size-4" />),
    ],
  },
];

const rhGroups: NavigationGroup[] = [
  {
    id: "pilotage",
    label: "Pilotage RH",
    icon: <BarChart3 className="size-4" />,
    items: [
      item(rhModule, "dashboard", <BarChart3 className="size-4" />),
      item(rhModule, "leave-requests", <ClipboardCheck className="size-4" />),
      item(rhModule, "permissions", <CalendarCheck className="size-4" />),
      item(rhModule, "global-view", <Globe className="size-4" />),
      item(rhModule, "alerts", <ShieldAlert className="size-4" />),
    ],
  },
  {
    id: "analytics",
    label: "Analytics RH",
    icon: <BarChart3 className="size-4" />,
    items: [
      item(rhModule, "analytics-workforce", <Users className="size-4" />),
      item(rhModule, "analytics-leaves", <CalendarDays className="size-4" />),
      item(rhModule, "analytics-alerts", <ShieldAlert className="size-4" />),
      item(rhModule, "analytics-trends", <BarChart3 className="size-4" />),
      item(rhModule, "analytics-management", <UserCog className="size-4" />),
      item(rhModule, "analytics-balances", <Wallet className="size-4" />),
      item(rhModule, "analytics-special-events", <Star className="size-4" />),
    ],
  },
  {
    id: "personnel",
    label: "Gestion du personnel",
    icon: <Users className="size-4" />,
    items: [
      item(rhModule, "employees", <Users className="size-4" />),
      item(rhModule, "hierarchy", <GitBranch className="size-4" />),
      item(rhModule, "children", <Baby className="size-4" />),
      item(rhModule, "special-leaves", <Star className="size-4" />),
      item(rhModule, "leave-balances", <Wallet className="size-4" />),
      item(rhModule, "leave-liabilities", <Coins className="size-4" />),
    ],
  },
  {
    id: "admin",
    label: "Administration RH",
    icon: <Settings className="size-4" />,
    items: [
      item(rhModule, "holidays", <CalendarOff className="size-4" />),
      item(rhModule, "exports", <ScrollText className="size-4" />),
      item(rhModule, "audit", <History className="size-4" />),
      item(rhModule, "settings", <Settings className="size-4" />),
    ],
  },
];

const adminGroups: NavigationGroup[] = [
  {
    id: "access",
    label: "Accès & utilisateurs",
    icon: <UserCog className="size-4" />,
    items: [
      item(adminModule, "users", <Users className="size-4" />),
      item(adminModule, "departments", <Building2 className="size-4" />),
    ],
  },
  {
    id: "configuration",
    label: "Configuration",
    icon: <SlidersHorizontal className="size-4" />,
    items: [
      item(adminModule, "holidays", <CalendarOff className="size-4" />),
      item(adminModule, "settings", <SlidersHorizontal className="size-4" />),
    ],
  },
  {
    id: "supervision",
    label: "Supervision",
    icon: <ScrollText className="size-4" />,
    items: [item(adminModule, "logs", <ScrollText className="size-4" />)],
  },
];

export function pickNavigation(pathname: string): {
  groups: NavigationGroup[] | null;
  flat: NavigationItem[] | null;
  section: string;
} {
  if (pathname.startsWith(managerModule.basePath))
    return { groups: managerGroups, flat: null, section: managerModule.label };
  if (pathname.startsWith(rhModule.basePath))
    return { groups: rhGroups, flat: null, section: rhModule.label };
  if (pathname.startsWith(adminModule.basePath))
    return { groups: adminGroups, flat: null, section: adminModule.label };
  return { groups: null, flat: employeeNav, section: employeeModule.label };
}
