import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { EnviosQueNoSalieronPage } from "./EnviosQueNoSalieronPage";
import type { EnviosQueNoSalieronResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function comoRol(role: "ADMIN" | "USER" | "RECEPCION") {
  useAuthMock.mockReturnValue({ me: { id: "yo", role } } as unknown as AuthContextValue);
}

const url = `${env.apiUrl}/api/envios-que-no-salieron`;
const branchesUrl = `${env.apiUrl}/api/branches`;

const RESPUESTA: EnviosQueNoSalieronResponse = {
  data: [
    {
      id: "e1",
      tipo: "RECORDATORIO_DE_TURNO",
      fecha: "2026-10-29T13:00:00.000Z",
      contacto: { id: "c1", nombre: "Ana Pérez" },
      sede: { id: "s1", nombre: "Centro" },
      motivo: "WhatsApp rechazó el envío",
    },
    {
      id: "e2",
      tipo: "AUTOMATIZACION",
      fecha: "2026-10-29T12:00:00.000Z",
      contacto: null,
      sede: null,
      motivo: "La automatización falló después de varios intentos",
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/envios-que-no-salieron"]}>
        <Routes>
          <Route path="/envios-que-no-salieron" element={<EnviosQueNoSalieronPage />} />
          <Route path="/tasks" element={<p>Mis tareas</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function conSedes(n: number) {
  const sedes = Array.from({ length: n }, (_, i) => ({
    id: `s${String(i + 1)}`,
    name: `Sede ${String(i + 1)}`,
  }));
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: sedes,
      pagination: { page: 1, pageSize: 100, total: n, totalPages: 1 },
    }),
  );
}

describe("EnviosQueNoSalieronPage", () => {
  it("lista fecha, tipo, cliente con link a su ficha, sede y motivo", async () => {
    comoRol("ADMIN");
    server.use(
      conSedes(1),
      http.get(url, () => HttpResponse.json(RESPUESTA)),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(tabla.getByText("Recordatorio de turno")).toBeInTheDocument();
    expect(tabla.getByRole("link", { name: "Ana Pérez" })).toHaveAttribute(
      "href",
      "/contacts/c1/edit",
    );
    expect(tabla.getByText("Centro")).toBeInTheDocument();
    expect(tabla.getByText("WhatsApp rechazó el envío")).toBeInTheDocument();
    expect(tabla.getByText("Automatización")).toBeInTheDocument();
  });

  it("un ADMIN con varias sedes tiene el filtro de Sede; con una sola, no", async () => {
    comoRol("ADMIN");
    server.use(
      conSedes(2),
      http.get(url, () => HttpResponse.json(RESPUESTA)),
    );

    renderPage();

    expect(await screen.findByLabelText("Sede")).toBeInTheDocument();
  });

  it("Recepción ve la lista (el backend la acota a sus sedes) y no tiene filtro de Sede", async () => {
    comoRol("RECEPCION");
    server.use(http.get(url, () => HttpResponse.json(RESPUESTA)));

    renderPage();

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sede")).not.toBeInTheDocument();
  });

  it("un USER no la ve: vuelve a Mis tareas", async () => {
    comoRol("USER");
    server.use(http.get(url, () => HttpResponse.json(RESPUESTA)));

    renderPage();

    expect(await screen.findByText("Mis tareas")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sin envíos fallidos, el estado vacío", async () => {
    comoRol("ADMIN");
    server.use(
      conSedes(1),
      http.get(url, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("No hay envíos que no hayan salido")).toBeInTheDocument();
  });
});
