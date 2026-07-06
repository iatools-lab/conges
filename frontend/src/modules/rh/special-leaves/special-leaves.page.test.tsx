import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { Speciaux } from "./special-leaves.page";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const eventRow = {
  id: "event:event-1",
  reference: "EVT-2026-000001",
  employeeId: "employee-1",
  employeeName: "Employee Test",
  matricule: "EMP001",
  department: "Operations",
  leaveTypeId: "",
  leaveTypeCode: "EVT",
  eventLabel: "Mariage",
  startDate: "2026-07-10",
  endDate: "2026-07-10",
  days: 0,
  proof: true,
  proofLabel: "Oui",
  proofUrl: "data:application/pdf;base64,cHJldXZl",
  status: "pending",
  statusCode: "PENDING",
  statusLabel: "À confirmer",
  quotaTotal: 0,
  quotaUsed: 0,
  quotaRemaining: 0,
  reason: "Mariage civil",
  rhComment: "",
};

describe("Speciaux - événements employés", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, options) => {
      if (path === "/rh/employees") return Promise.resolve([]);
      if (path.startsWith("/rh/special-leaves?")) {
        return Promise.resolve({
          year: 2026,
          rows: [eventRow],
          totals: { total: 1, approved: 0, pending: 1, days: 0 },
        });
      }
      if (path === "/rh/special-leaves/event:event-1" && options?.method === "PATCH") {
        return Promise.resolve({ ...eventRow, statusCode: "IN_REVIEW" });
      }
      return Promise.resolve({});
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <Speciaux />
      </QueryClientProvider>,
    );
  }

  it("offers uniform actions, previews a PDF and saves the RH review comment", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Employee Test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByText("Voir le détail")).toBeInTheDocument();
    expect(screen.getByText("Mettre en revue")).toBeInTheDocument();
    expect(screen.getByText("Refuser")).toBeInTheDocument();
    expect(screen.getByText("Valider")).toBeInTheDocument();

    await user.click(screen.getByText("Voir le justificatif"));
    expect(await screen.findByTitle("Justificatif EVT-2026-000001")).toHaveAttribute(
      "src",
      eventRow.proofUrl,
    );
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByText("Mettre en revue"));
    await user.type(
      screen.getByRole("textbox", { name: /commentaire rh/i }),
      "Merci de préciser la date sur le document.",
    );
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/rh/special-leaves/event:event-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "IN_REVIEW",
            rhComment: "Merci de préciser la date sur le document.",
          }),
        }),
      ),
    );
  }, 10000);
});
