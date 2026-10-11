import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeResource } from "../../test/resourceFixtures";
import { openActionsMenu } from "../../test/openActionsMenu";
import type { AuthContextValue } from "../../auth/AuthContext";
import { PrestacionesPage } from "./PrestacionesPage";
import type { PrestacionConProfesionales } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));
// Sin vocabulario en /me: la pantalla usa los textos de clínica por defecto.
const useAuthMock = vi.hoisted(() => vi.fn<() => Partial<AuthContextValue>>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

const LIMPIEZA: PrestacionConProfesionales = {
  id: "st1",
  branchId: "b1",
  name: "Limpieza facial",
  durationMin: 60,
  capacity: 1,
  resourceId: "r1",
  profesionales: [{ id: "r1", name: "Ana Profesional", branchId: "b1" }],
  followUpAfterDays: null,
};

function renderPage() {
  useAuthMock.mockReturnValue({ me: null });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PrestacionesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PrestacionesPage (R5)", () => {
  it("lista las prestaciones con sus profesionales y guarda los elegidos (el principal queda fijo)", async () => {
    let enviado: unknown;
    server.use(
      http.get(`${env.apiUrl}/api/clinica/prestaciones`, () =>
        HttpResponse.json({ prestaciones: [LIMPIEZA] }),
      ),
      http.get(`${env.apiUrl}/api/branches`, () =>
        HttpResponse.json({
          data: [makeBranch({ id: "b1", name: "Sede Centro" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(`${env.apiUrl}/api/resources`, () =>
        HttpResponse.json({
          data: [
            makeResource({ id: "r1", name: "Ana Profesional", branchId: "b1" }),
            makeResource({ id: "r2", name: "Bruno Profesional", branchId: "b1" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
      http.put(`${env.apiUrl}/api/clinica/prestaciones/st1/profesionales`, async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ profesionales: [] });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Prestaciones" })).toBeInTheDocument();
    expect(await screen.findByText("Limpieza facial")).toBeInTheDocument();
    expect(screen.getByText("Ana Profesional")).toBeInTheDocument();
    expect(await screen.findByText("Sede Centro")).toBeInTheDocument();

    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Elegir profesionales" }));

    const principal = await screen.findByRole("checkbox", { name: "Ana Profesional (principal)" });
    expect(principal).toBeChecked();
    expect(principal).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Bruno Profesional" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(enviado).toEqual({ resourceIds: ["r1", "r2"] }));
  });
});

// R14 (docs/rubros.md §7.2): "Recordar control a los N días".
describe("PrestacionesPage — control (R14)", () => {
  function base() {
    return [
      http.get(`${env.apiUrl}/api/clinica/prestaciones`, () =>
        HttpResponse.json({ prestaciones: [{ ...LIMPIEZA, followUpAfterDays: 30 }] }),
      ),
      http.get(`${env.apiUrl}/api/branches`, () =>
        HttpResponse.json({
          data: [makeBranch({ id: "b1", name: "Sede Centro" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    ];
  }

  it("muestra el control y lo guarda; vacío lo saca", async () => {
    const enviados: unknown[] = [];
    server.use(
      ...base(),
      http.put(`${env.apiUrl}/api/clinica/prestaciones/st1/control`, async ({ request }) => {
        const body = await request.json();
        enviados.push(body);
        return HttpResponse.json({ id: "st1", ...(body as object) });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("A los 30 días")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /acciones/i }));
    await user.click(screen.getByRole("menuitem", { name: "Recordar control" }));
    const campo = screen.getByLabelText("Recordar control a los N días");
    await user.clear(campo);
    await user.type(campo, "45");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(enviados).toEqual([{ followUpAfterDays: 45 }]));
  });

  it("fuera de rango no se manda", async () => {
    let llamadas = 0;
    server.use(
      ...base(),
      http.put(`${env.apiUrl}/api/clinica/prestaciones/st1/control`, () => {
        llamadas++;
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("A los 30 días");
    await user.click(screen.getByRole("button", { name: /acciones/i }));
    await user.click(screen.getByRole("menuitem", { name: "Recordar control" }));
    const campo = screen.getByLabelText("Recordar control a los N días");
    await user.clear(campo);
    await user.type(campo, "800");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/de 1 a 730/)).toBeInTheDocument();
    expect(llamadas).toBe(0);
  });
});
