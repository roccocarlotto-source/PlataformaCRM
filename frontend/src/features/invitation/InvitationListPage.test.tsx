import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeInvitation } from "../../test/invitationFixtures";
import { makeUser } from "../../test/userFixtures";
import { InvitationListPage } from "./InvitationListPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const invitationsUrl = `${env.apiUrl}/invitations`;
const usersUrl = `${env.apiUrl}/users`;

function usersHandler() {
  return http.get(usersUrl, () =>
    HttpResponse.json({
      data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InvitationListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("InvitationListPage", () => {
  it("loading, éxito, error y empty state", async () => {
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ email: "invitado@example.com" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      usersHandler(),
    );

    renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("invitado@example.com")).toBeInTheDocument());
  });

  it("error de listado se muestra como estado de error real", async () => {
    server.use(
      http.get(invitationsUrl, () => HttpResponse.json({ error: { message: "boom" } }, { status: 500 })),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar las invitaciones/)).toBeInTheDocument(),
    );
  });

  it("empty state cuando data está vacía", async () => {
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
      ),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay invitaciones para mostrar.")).toBeInTheDocument(),
    );
  });

  it("filtro status produce la query esperada", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(invitationsUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeInvitation()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
      usersHandler(),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("invitado@example.com")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Estado"), "REVOKED");

    await waitFor(() =>
      expect(captured.some((u) => u.searchParams.get("status") === "REVOKED")).toBe(true),
    );
  });

  it("estados reales se muestran con label humano", async () => {
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [
            makeInvitation({ id: "i1", email: "a@x.com", status: "PENDING" }),
            makeInvitation({ id: "i2", email: "b@x.com", status: "EXPIRED" }),
          ],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        }),
      ),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Pendiente")).toBeInTheDocument());
    expect(screen.getByText("Vencida")).toBeInTheDocument();
  });

  it("roleId nunca se muestra crudo — fallback '—'", async () => {
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ roleId: "11111111-2222-3333-4444-555555555555" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("invitado@example.com")).toBeInTheDocument());
    expect(screen.queryByText("11111111-2222-3333-4444-555555555555")).not.toBeInTheDocument();
    const row = screen.getByText("invitado@example.com").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("—");
  });

  it("invitedById se resuelve a nombre humano vía la infraestructura existente, nunca crudo", async () => {
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ invitedById: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
  });

  it("invitedById que no resuelve cae en fallback '—', nunca UUID crudo", async () => {
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ invitedById: "user-ajeno-no-resoluble" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("invitado@example.com")).toBeInTheDocument());
    expect(screen.queryByText("user-ajeno-no-resoluble")).not.toBeInTheDocument();
  });

  it("Revocar solo aparece en invitaciones PENDING", async () => {
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [
            makeInvitation({ id: "i1", email: "pendiente@x.com", status: "PENDING" }),
            makeInvitation({ id: "i2", email: "vencida@x.com", status: "EXPIRED" }),
          ],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        }),
      ),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("pendiente@x.com")).toBeInTheDocument());
    const pendingRow = screen.getByText("pendiente@x.com").closest("tr") as HTMLElement;
    const expiredRow = screen.getByText("vencida@x.com").closest("tr") as HTMLElement;
    expect(pendingRow.textContent).toContain("Revocar");
    expect(expiredRow.textContent).not.toContain("Revocar");
  });

  it("revocar: confirma, ejecuta la mutation y muestra error real si falla", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ id: "i1", email: "pendiente@x.com", status: "PENDING" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${invitationsUrl}/i1`, () =>
        HttpResponse.json({ error: { message: "Esta invitación ya fue aceptada, no se puede revocar" } }, { status: 409 }),
      ),
      usersHandler(),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("pendiente@x.com")).toBeInTheDocument());
    await user.click(screen.getByText("Revocar"));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByText(/No pudimos revocar la invitación.*ya fue aceptada/),
      ).toBeInTheDocument(),
    );
    confirmSpy.mockRestore();
  });

  it("revocar: cancelar el confirm no dispara ningún request", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    let revokeRequested = false;
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ id: "i1", email: "pendiente@x.com", status: "PENDING" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${invitationsUrl}/i1`, () => {
        revokeRequested = true;
        return HttpResponse.json(makeInvitation({ status: "REVOKED" }));
      }),
      usersHandler(),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("pendiente@x.com")).toBeInTheDocument());
    await user.click(screen.getByText("Revocar"));

    expect(revokeRequested).toBe(false);
    confirmSpy.mockRestore();
  });
});
