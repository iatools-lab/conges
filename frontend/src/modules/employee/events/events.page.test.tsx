import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { Declarer } from "./events.page";
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

describe("Declarer", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path.startsWith("/employee/events?")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ id: "event-1" });
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <Declarer />
      </QueryClientProvider>,
    );
  }

  it("submits an event declaration and resets the form after success", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /nouvelle déclaration/i }));
    await screen.findByRole("dialog");

    const comment = document.querySelector("textarea");
    expect(comment).not.toBeNull();
    await user.type(comment, "Naissance déclarée");
    const proof = new File(["justificatif"], "justificatif.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText(/choisir un justificatif/i), proof);
    await user.click(screen.getByRole("button", { name: /soumettre à la rh/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/employee/events", expect.anything()),
    );
    const [path, options] = vi
      .mocked(apiFetch)
      .mock.calls.find(([calledPath]) => calledPath === "/employee/events")!;
    const body = options?.body as FormData;

    expect(path).toBe("/employee/events");
    expect(options).toEqual(expect.objectContaining({ method: "POST" }));
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("userId")).toBe(session.id);
    expect(body.get("userEmail")).toBe(session.email);
    expect(body.get("type")).toBe("BIRTH");
    expect(body.get("childBirthDate")).toBeTruthy();
    expect(body.get("description")).toBe("Naissance déclarée");
    expect((body.get("proof") as File).name).toBe("justificatif.pdf");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("submits a custom event label when Other is selected", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /nouvelle/i }));
    await screen.findByRole("dialog");

    await user.selectOptions(screen.getByRole("combobox"), "OTHER");
    await user.type(screen.getByLabelText(/autre type/i), "Déménagement");
    const comment = document.querySelector("textarea");
    expect(comment).not.toBeNull();
    await user.type(comment, "Nouveau domicile");
    await user.click(screen.getByRole("button", { name: /soumettre/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/employee/events", expect.anything()),
    );
    const [, options] = vi
      .mocked(apiFetch)
      .mock.calls.find(([calledPath]) => calledPath === "/employee/events")!;
    const body = options?.body as FormData;

    expect(body.get("type")).toBe("OTHER");
    expect(body.get("childBirthDate")).toBeNull();
    expect(body.get("description")).toBe("Déménagement - Nouveau domicile");
  });

  it("shows the RH review status and comment to the employee", async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path.startsWith("/employee/events?")) {
        return Promise.resolve({
          rows: [
            {
              id: "event-1",
              type: "MARRIAGE",
              typeLabel: "Mariage",
              eventDate: "10/07/2026",
              createdAt: "01/07/2026",
              description: "Mariage civil",
              hasProof: true,
              processed: false,
              statusCode: "IN_REVIEW",
              statusLabel: "En revue RH",
              statusTone: "pending",
              rhComment: "Merci de préciser la date sur le document.",
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    renderPage();

    expect(await screen.findByText("En revue RH")).toBeInTheDocument();
    expect(screen.getByText("Merci de préciser la date sur le document.")).toBeInTheDocument();
  });
});
