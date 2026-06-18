import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { ManagerDemandes } from "./requests.page";
import type { AuthSession } from "@/modules/auth/session";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("@/modules/auth/session", () => ({
  useAuthSession: () => ({ ready: true, session }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const session: AuthSession = {
  id: "manager-1",
  matricule: "MGR001",
  email: "manager@upowa.org",
  name: "Manager Test",
  poste: "Chef Operations",
  department: { id: "dept-1", code: "OPS", name: "Operations" },
  roles: ["manager"],
  primaryRole: "manager",
  homePath: "/manager",
};

const directRequest = {
  id: "request-direct",
  reference: "DM-DIRECT",
  emp: "Employee Direct",
  employeeName: "Employee Direct",
  matricule: "EMP001",
  poste: "Agent",
  dept: "OPS",
  departmentName: "Operations",
  type: "Congé payé",
  typeCode: "CP",
  debut: "01/06/2026",
  fin: "03/06/2026",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  jours: 3,
  solde: 12,
  status: "pending",
  statusCode: "PENDING",
  statusLabel: "En attente manager",
  canDecide: true,
  motif: "Repos",
  envoyee: "29/05/2026",
  submittedAt: "2026-05-29T09:00:00.000Z",
};

const watcherRequest = {
  ...directRequest,
  id: "request-watcher",
  reference: "DM-WATCH",
  emp: "Employee Watcher",
  canDecide: false,
};

function managerResponse(rows: Array<typeof directRequest>) {
  return {
    year: 2026,
    manager: {
      id: session.id,
      name: session.name,
      department: session.department,
      managedDepartments: [session.department],
    },
    rows,
    totals: {
      total: rows.length,
      pending: rows.filter((row) => row.status === "pending").length,
      revision: 0,
      valid: 0,
      rejected: 0,
    },
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ManagerDemandes />
    </QueryClientProvider>,
  );
}

describe("ManagerDemandes", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("shows read-only pending requests for N+2/N+3 watchers", async () => {
    vi.mocked(apiFetch).mockResolvedValue(managerResponse([watcherRequest]));

    renderPage();

    expect(await screen.findByText("DM-WATCH")).toBeInTheDocument();
    expect(screen.getByText("En attente manager")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /détail/i })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /^valider$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^refuser$/i })).not.toBeInTheDocument();
  });

  it("submits an approve decision for direct N+1 pending requests", async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/manager/requests/request-direct/decision") {
        return Promise.resolve({
          ...directRequest,
          status: "revision",
          statusLabel: "En revue RH",
        });
      }

      return Promise.resolve(managerResponse([directRequest]));
    });

    renderPage();

    expect(await screen.findByText("DM-DIRECT")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^valider$/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/manager/requests/request-direct/decision",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            managerId: session.id,
            managerEmail: session.email,
            decision: "approve",
          }),
        }),
      ),
    );
  });
});
