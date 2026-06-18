import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { Planifier } from "./planning.page";
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
  id: "employee-1",
  matricule: "EMP001",
  email: "employee@upowa.org",
  name: "Employee Test",
  poste: "Agent",
  department: { id: "dept-1", code: "OPS", name: "Operations" },
  roles: ["employee"],
  primaryRole: "employee",
  homePath: "/",
};

const planningResponse = {
  year: 2026,
  user: {
    name: "Employee Test",
    matricule: "EMP001",
    department: { name: "Operations", manager: "Manager Test" },
  },
  leaveTypes: [{ code: "CP", name: "Congé payé", requiresProof: false }],
  stats: { totalPlanifie: 3, draft: 1, pending: 0, valid: 0, rejected: 0 },
  plans: [
    {
      id: "plan-1",
      reference: "DM-PLAN",
      debut: "01/06/2026",
      fin: "03/06/2026",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      jours: 3,
      type: "CP",
      typeLabel: "Congé payé",
      category: "CONGE_PAYE",
      statusCode: "DRAFT",
      status: "planned",
      label: "Planifié",
      remplacant: "—",
      reason: "Plan annuel",
      canSubmit: true,
      canCancel: true,
      canDelete: true,
    },
  ],
};

const requestsResponse = {
  leaveTypes: planningResponse.leaveTypes,
  rows: [],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Planifier />
    </QueryClientProvider>,
  );
}

describe("Planifier", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path.startsWith("/employee/planning")) return Promise.resolve(planningResponse);
      if (path.startsWith("/employee/leave-requests?")) return Promise.resolve(requestsResponse);
      if (path.includes("/submit")) return Promise.resolve(planningResponse.plans[0]);
      if (path.includes("/permanent")) return Promise.resolve({ id: "plan-1", deleted: true });
      return Promise.resolve(planningResponse.plans[0]);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows planned status and exposes submit/cancel/delete actions for planned drafts", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: /planifier un congé/i }));
    expect(await screen.findByText("DM-PLAN")).toBeInTheDocument();
    expect(screen.getAllByText("Planifié").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /actions/i }));

    expect(await screen.findByRole("menuitem", { name: /soumettre/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /annuler/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /supprimer/i })).toBeInTheDocument();
  });

  it("submits a planned draft through the submit endpoint", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: /planifier un congé/i }));
    await user.click(await screen.findByRole("button", { name: /actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /soumettre/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/employee/leave-requests/plan-1/submit",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows the review comment and resubmits an edited request", async () => {
    const user = userEvent.setup();
    const reviewComment = "Merci de corriger la date de fin";
    const reviewedRequest = {
      id: "request-review-1",
      reference: "DM-REVIEW",
      date: "05/06/2026",
      type: "Congé payé",
      leaveTypeCode: "CP",
      startDate: "2026-06-10",
      endDate: "2026-06-12",
      reason: "Demande initiale",
      periode: "10/06/2026 → 12/06/2026",
      jours: 3,
      status: "review",
      stext: "En revue",
      last: reviewComment,
      reviewComment,
      canEdit: true,
      canCancel: true,
    };

    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path.startsWith("/employee/planning")) return Promise.resolve(planningResponse);
      if (path.startsWith("/employee/leave-requests?")) {
        return Promise.resolve({ ...requestsResponse, rows: [reviewedRequest] });
      }
      if (path === "/employee/leave-requests/request-review-1") {
        return Promise.resolve(reviewedRequest);
      }
      return Promise.resolve(planningResponse.plans[0]);
    });

    renderPage();

    expect(await screen.findAllByText(reviewComment)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /modifier/i }));

    const endDateInput = await screen.findByDisplayValue("2026-06-12");
    await user.clear(endDateInput);
    await user.type(endDateInput, "2026-06-15");
    await user.click(screen.getByRole("button", { name: /renvoyer la demande/i }));

    await waitFor(() => {
      const patchCall = vi
        .mocked(apiFetch)
        .mock.calls.find(
          ([path, options]) =>
            path === "/employee/leave-requests/request-review-1" && options?.method === "PATCH",
        );

      expect(patchCall).toBeDefined();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        userId: session.id,
        userEmail: session.email,
        leaveTypeCode: "CP",
        startDate: "2026-06-10",
        endDate: "2026-06-15",
        reason: "Demande initiale",
      });
    });
  });
});
