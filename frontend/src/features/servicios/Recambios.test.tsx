import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { RecambiosPage } from "./RecambiosPage";
import type { RecambioVencido, RecambiosResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

beforeEach(() => {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@example.com",
      fullName: "A",
      organizationId: "org-1",
      role: "USER",
      isPlatformAdmin: false,
      canUseInternalAgent: false,
      modulos: ["servicios"],
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  });
});

const API = `${env.apiUrl}/api`;

const fila = (n: number): RecambioVencido => ({
  id: `v${String(n)}`,
  cliente: `Cliente ${String(n)}`,
  vehiculo: "Fiat Uno (ABC 123)",
  vendedor: n === 1 ? "Vendedor Uno" : null,
  compra: "2018-03-01",
  recambio: "2022-03-01",
  aviso: "2021-12-31",
  vencidoHace: 1690,
});

function respuesta(filas: RecambioVencido[]): RecambiosResponse {
  return {
    data: filas,
    pagination: { page: 1, pageSize: 50, total: filas.length, totalPages: filas.length ? 1 : 0 },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RecambiosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sucursales = http.get(`${API}/branches`, () =>
  HttpResponse.json({
    data: [{ id: "b1", name: "Centro" }],
    pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  }),
);

describe("Taller → Recambios (S13)", () => {
  it("lista los vencidos de a 50 y la acción de una fila registra el aviso y la saca", async () => {
    let filas = [fila(1), fila(2)];
    const pedidos: URLSearchParams[] = [];
    const avisos: unknown[] = [];
    server.use(
      sucursales,
      http.get(`${API}/servicios/recambios`, ({ request }) => {
        pedidos.push(new URL(request.url).searchParams);
        return HttpResponse.json(respuesta(filas));
      }),
      http.post(`${API}/servicios/recambios/avisos`, async ({ request }) => {
        const body = (await request.json()) as { vehiculoIds: string[] };
        avisos.push(body);
        filas = filas.filter((f) => !body.vehiculoIds.includes(f.id));
        return HttpResponse.json({ resultados: body.vehiculoIds.map((id) => ({ id, ok: true })) });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const primera = (await screen.findByRole("link", { name: "Cliente 1" })).closest("tr")!;
    expect(pedidos[0].get("estado")).toBe("vencidos");
    expect(pedidos[0].get("pageSize")).toBe("50");
    expect(within(primera).getByText("Vendedor Uno")).toBeInTheDocument();
    expect(within(primera).getByText("1690 días")).toBeInTheDocument();

    await user.click(within(primera).getByRole("button", { name: "Crear tarea al vendedor" }));
    await waitFor(() => expect(avisos).toEqual([{ vehiculoIds: ["v1"], accion: "TAREA" }]));
    expect(await screen.findByText("Tarea creada.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Cliente 1" })).not.toBeInTheDocument(),
    );
  });

  it("con varias seleccionadas, 'Marcar como contactado' las manda juntas y avisa las que fallan", async () => {
    const avisos: unknown[] = [];
    server.use(
      sucursales,
      http.get(`${API}/servicios/recambios`, () =>
        HttpResponse.json(respuesta([fila(1), fila(2), fila(3)])),
      ),
      http.post(`${API}/servicios/recambios/avisos`, async ({ request }) => {
        const body = (await request.json()) as { vehiculoIds: string[] };
        avisos.push(body);
        return HttpResponse.json({
          resultados: [
            { id: "v1", ok: true },
            { id: "v3", ok: false, error: "Este recambio ya estaba registrado." },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByLabelText("Seleccionar el recambio de Cliente 1, Fiat Uno (ABC 123)"),
    );
    await user.click(
      screen.getByLabelText("Seleccionar el recambio de Cliente 3, Fiat Uno (ABC 123)"),
    );
    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();
    const barra = screen.getByText("2 seleccionados").closest("div")!;
    await user.click(within(barra).getByRole("button", { name: "Marcar como contactado" }));

    await waitFor(() =>
      expect(avisos).toEqual([{ vehiculoIds: ["v1", "v3"], accion: "CONTACTADO" }]),
    );
    expect(
      await screen.findByText(/1 listos; 1 no se pudieron: Este recambio ya estaba registrado\./),
    ).toBeInTheDocument();
  });

  it("la fila sale apenas se toca la acción, antes de que responda el servidor", async () => {
    let responder: (() => void) | undefined;
    server.use(
      sucursales,
      http.get(`${API}/servicios/recambios`, () =>
        HttpResponse.json(respuesta([fila(1), fila(2)])),
      ),
      http.post(`${API}/servicios/recambios/avisos`, async () => {
        await new Promise<void>((resolve) => {
          responder = resolve;
        });
        return HttpResponse.json({ resultados: [{ id: "v1", ok: true }] });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const primera = (await screen.findByRole("link", { name: "Cliente 1" })).closest("tr")!;
    await user.click(within(primera).getByRole("button", { name: "Marcar como contactado" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Cliente 1" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Cliente 2" })).toBeInTheDocument();
    await waitFor(() => expect(responder).toBeDefined());
    responder?.();
    expect(await screen.findByText("Marcado como contactado.")).toBeInTheDocument();
  });

  it("si el servidor rechaza el pedido, la fila vuelve", async () => {
    server.use(
      sucursales,
      http.get(`${API}/servicios/recambios`, () => HttpResponse.json(respuesta([fila(1)]))),
      http.post(`${API}/servicios/recambios/avisos`, () =>
        HttpResponse.json({ error: { message: "No se pudo registrar." } }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    const primera = (await screen.findByRole("link", { name: "Cliente 1" })).closest("tr")!;
    await user.click(within(primera).getByRole("button", { name: "Crear tarea al vendedor" }));
    expect(await screen.findByText(/No se pudo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cliente 1" })).toBeInTheDocument();
  });

  it("sin vencidos, el estado vacío", async () => {
    server.use(
      sucursales,
      http.get(`${API}/servicios/recambios`, () => HttpResponse.json(respuesta([]))),
    );
    renderPage();
    expect(await screen.findByText("No hay recambios vencidos sin contactar")).toBeInTheDocument();
  });
});
