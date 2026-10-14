import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeFichaDeVehiculo, makeVehiculoDeCliente } from "../../test/vehiculoDeClienteFixtures";
import { VehiculosDeClientesPage } from "./VehiculosDeClientesPage";
import { VehiculoDeClienteFormPage } from "./VehiculoDeClienteFormPage";
import { VehiculoDeClienteDetailPage } from "./VehiculoDeClienteDetailPage";

// Las pantallas del taller de S3 (docs/servicios.md §4.5): listado con
// búsqueda, alta con el 409 de duplicado y ficha con Cambiar dueño.

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@example.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
      canUseInternalAgent: false,
      modulos: ["servicios"],
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue(mockAuth("ADMIN"));
});

const VEHICULOS = `${env.apiUrl}/api/servicios/vehiculos`;

function lista(data: ReturnType<typeof makeVehiculoDeCliente>[]) {
  return { data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } };
}

function renderEn(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/taller/vehiculos" element={<VehiculosDeClientesPage />} />
          <Route path="/taller/vehiculos/nuevo" element={<VehiculoDeClienteFormPage />} />
          <Route path="/taller/vehiculos/:id" element={<VehiculoDeClienteDetailPage />} />
          <Route path="/taller/vehiculos/:id/editar" element={<VehiculoDeClienteFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Vehículos de clientes — listado", () => {
  it("muestra matrícula, dueño, próximo service y la orden abierta, con link a la ficha", async () => {
    server.use(
      http.get(VEHICULOS, () =>
        HttpResponse.json(
          lista([
            makeVehiculoDeCliente({
              ordenAbierta: { id: "o1", numero: "OS-0007", status: "EN_TRABAJO" },
            }),
          ]),
        ),
      ),
    );
    renderEn("/taller/vehiculos");
    const link = await screen.findByRole("link", { name: "SBC 1001" });
    expect(link).toHaveAttribute("href", "/taller/vehiculos/cv1");
    const fila = link.closest("tr") as HTMLElement;
    expect(within(fila).getByText("Ana Ejemplo")).toBeInTheDocument();
    expect(within(fila).getByText("Toyota Hilux 2020")).toBeInTheDocument();
    expect(within(fila).getByText("OS-0007 · En trabajo")).toBeInTheDocument();
  });

  it("busca con lo escrito y, sin resultados, ofrece crear el vehículo con esa matrícula", async () => {
    const pedidos: string[] = [];
    server.use(
      http.get(VEHICULOS, ({ request }) => {
        pedidos.push(new URL(request.url).searchParams.get("q") ?? "");
        return HttpResponse.json(lista([]));
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/vehiculos");
    await user.type(screen.getByPlaceholderText(/Buscar por matrícula/), "abc 12");
    const crear = await screen.findByRole("link", { name: "Crear vehículo con esta matrícula" });
    expect(crear).toHaveAttribute("href", "/taller/vehiculos/nuevo?matricula=abc%2012");
    expect(pedidos).toContain("abc 12");
  });
});

describe("Vehículos de clientes — alta", () => {
  it("un 409 de matrícula repetida ofrece abrir el vehículo que ya la tiene", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/branches`, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
      http.get(`${env.apiUrl}/api/contacts/:id`, () =>
        HttpResponse.json({ id: "ct1", firstName: "Ana", lastName: "Ejemplo" }),
      ),
      http.post(VEHICULOS, () =>
        HttpResponse.json(
          {
            error: {
              message: "Ya hay un vehículo de cliente con esa matrícula.",
              code: "VEHICULO_DUPLICADO",
              campo: "licensePlate",
              vehiculoId: "cv9",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderEn("/taller/vehiculos/nuevo?matricula=SBC1001&contactId=ct1");
    expect(screen.getByLabelText("Matrícula")).toHaveValue("SBC1001");
    await user.type(screen.getByLabelText("Marca"), "Toyota");
    await user.type(screen.getByLabelText("Modelo"), "Hilux");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    const abrir = await screen.findByRole("link", { name: "Abrir el vehículo" });
    expect(abrir).toHaveAttribute("href", "/taller/vehiculos/cv9");
  });
});

describe("Vehículos de clientes — ficha", () => {
  function fichaHandlers(ficha = makeFichaDeVehiculo()) {
    return [
      http.get(`${VEHICULOS}/:id`, () => HttpResponse.json(ficha)),
      http.get(`${VEHICULOS}/:id/ordenes`, () => HttpResponse.json([])),
    ];
  }

  it("ADMIN ve Eliminar; USER no", async () => {
    server.use(...fichaHandlers());
    const { unmount } = renderEn("/taller/vehiculos/cv1");
    expect(await screen.findByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(await screen.findByText("Todavía no tiene órdenes.")).toBeInTheDocument();
    unmount();

    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderEn("/taller/vehiculos/cv1");
    expect(await screen.findByRole("button", { name: "Cambiar dueño" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });

  it("ya no es del cliente: lo dice, con el motivo, y no ofrece Cambiar dueño", async () => {
    server.use(
      ...fichaHandlers(
        makeFichaDeVehiculo({
          ownershipEndedAt: "2026-10-01T12:00:00.000Z",
          ownershipEndReason: "VENDIDO_A_TERCERO",
        }),
      ),
    );
    renderEn("/taller/vehiculos/cv1");
    expect(await screen.findByText("Ya no es del cliente")).toBeInTheDocument();
    expect(screen.getByText(/Lo vendió a un tercero/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cambiar dueño" })).toBeNull();
  });

  it("Cambiar dueño → ya no es de un cliente: manda el motivo y la nota", async () => {
    let body: unknown;
    server.use(
      ...fichaHandlers(),
      http.post(`${VEHICULOS}/:id/dueno`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          makeFichaDeVehiculo({
            ownershipEndedAt: "2026-10-14T12:00:00.000Z",
            ownershipEndReason: "VENDIDO_A_TERCERO",
          }),
        );
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/vehiculos/cv1");
    await user.click(await screen.findByRole("button", { name: "Cambiar dueño" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByLabelText(/lo vendió a un tercero/));
    await user.type(within(dialogo).getByLabelText("Nota"), "Lo vendió por su cuenta");
    await user.click(within(dialogo).getByRole("button", { name: "Cambiar dueño" }));
    await waitFor(() =>
      expect(body).toEqual({ fin: "VENDIDO_A_TERCERO", nota: "Lo vendió por su cuenta" }),
    );
    expect(await screen.findByText("Ya no es del cliente")).toBeInTheDocument();
  });
});
