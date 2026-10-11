import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { ConfirmProvider } from "../../design-system/ConfirmDialog";
import { OrganizationsPage } from "./OrganizationsPage";
import type { PlatformOrganization } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const listUrl = `${env.apiUrl}/api/admin/organizations`;
const editionsUrl = `${env.apiUrl}/api/admin/organizations/editions`;
const editionUrl = (id: string) => `${env.apiUrl}/api/admin/organizations/${id}/edition`;
const reenviarUrl = (id: string) =>
  `${env.apiUrl}/api/admin/organizations/${id}/admin-invitation/resend`;

const ORGS: PlatformOrganization[] = [
  {
    id: "org-1",
    name: "Automotora Centro",
    slug: "automotora-centro",
    edition: "COMPLETA",
    industry: "AUTOMOTORA",
  },
  {
    id: "org-2",
    name: "Automotora Norte",
    slug: "automotora-norte",
    edition: "ESENCIAL",
    industry: "AUTOMOTORA",
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={["/admin/organizations"]}>
          <Routes>
            <Route path="/admin/organizations" element={<OrganizationsPage />} />
            <Route path="/" element={<p>Inicio</p>} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("OrganizationsPage", () => {
  beforeEach(() => {
    server.use(http.get(listUrl, () => HttpResponse.json(ORGS)));
  });

  it("mientras el backend no ofrezca ESENCIAL (hoy), no se muestra: vuelve al inicio", async () => {
    server.use(http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA"] })));
    renderPage();

    expect(await screen.findByText("Inicio")).toBeInTheDocument();
    expect(screen.queryByText("Automotora Norte")).not.toBeInTheDocument();
  });

  it("con ESENCIAL ofrecida: lista la edición de cada una y el botón solo en las ESENCIAL", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
    );
    renderPage();

    const centro = (await screen.findByText("Automotora Centro")).closest("tr")!;
    const norte = screen.getByText("Automotora Norte").closest("tr")!;
    expect(within(centro).getByText("Completa")).toBeInTheDocument();
    expect(within(norte).getByText("Esencial")).toBeInTheDocument();
    expect(
      within(centro).queryByRole("button", { name: "Pasar a edición completa" }),
    ).not.toBeInTheDocument();
    // Reenviar la invitación está en todas las filas (ver OrganizationsPage).
    expect(within(centro).getByRole("button", { name: "Reenviar invitación" })).toBeInTheDocument();
    expect(
      within(norte).getByRole("button", { name: "Pasar a edición completa" }),
    ).toBeInTheDocument();
  });

  // Reenviar (prueba de la Clínica Demo, 2026-10-11).
  it("reenviar la invitación: pide confirmación, manda el POST y dice a qué email salió", async () => {
    let reenvios = 0;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.post(reenviarUrl("org-1"), () => {
        reenvios += 1;
        return HttpResponse.json({ email: "admin@example.com" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const fila = (await screen.findByText("Automotora Centro")).closest("tr") as HTMLElement;
    await user.click(within(fila).getByRole("button", { name: "Reenviar invitación" }));
    expect(screen.getByText(/Le llega de nuevo el mail/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reenviamos la invitación de «Automotora Centro» a admin@example.com.",
    );
    expect(reenvios).toBe(1);
  });

  it("reenviar la invitación: si el administrador ya la aceptó, muestra el error del backend", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.post(reenviarUrl("org-1"), () =>
        HttpResponse.json(
          {
            error: {
              message:
                "El administrador de esta organización ya aceptó la invitación: no hay nada que reenviar.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    const fila = (await screen.findByText("Automotora Centro")).closest("tr") as HTMLElement;
    await user.click(within(fila).getByRole("button", { name: "Reenviar invitación" }));
    await user.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(
      await screen.findByText(
        "El administrador de esta organización ya aceptó la invitación: no hay nada que reenviar.",
      ),
    ).toBeInTheDocument();
  });

  it("pasar a completa: pide confirmación, manda el PATCH y muestra la edición nueva", async () => {
    let body: unknown;
    let lista = ORGS;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.get(listUrl, () => HttpResponse.json(lista)),
      http.patch(editionUrl("org-2"), async ({ request }) => {
        body = await request.json();
        lista = ORGS.map((o) => (o.id === "org-2" ? { ...o, edition: "COMPLETA" as const } : o));
        return HttpResponse.json({ id: "org-2", edition: "COMPLETA" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Pasar a edición completa" }));
    expect(screen.getByText(/No se puede volver a la edición esencial/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pasar a completa" }));

    await waitFor(() => expect(body).toEqual({ edition: "COMPLETA" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "«Automotora Norte» ya tiene la edición completa.",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Pasar a edición completa" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("cancelar la confirmación no manda nada", async () => {
    let pidio = false;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.patch(editionUrl("org-2"), () => {
        pidio = true;
        return HttpResponse.json({ id: "org-2", edition: "COMPLETA" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Pasar a edición completa" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(pidio).toBe(false);
  });

  it("si el backend rechaza (por ejemplo, 409), muestra el error", async () => {
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.patch(editionUrl("org-2"), () =>
        HttpResponse.json({ error: { message: "No se puede bajar de edición" } }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Pasar a edición completa" }));
    await user.click(screen.getByRole("button", { name: "Pasar a completa" }));
    expect(await screen.findByText(/No se puede bajar de edición/)).toBeInTheDocument();
  });
});
