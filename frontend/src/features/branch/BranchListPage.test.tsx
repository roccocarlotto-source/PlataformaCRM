import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { openActionsMenu } from "../../test/openActionsMenu";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { BranchListPage } from "./BranchListPage";
import type { BranchListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usan los casos de AdminRoute del final: la página en sí no consume
// useAuth (no tiene gate por rol, ver el comentario de BranchListPage).
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const baseUrl = `${env.apiUrl}/api/branches`;

function listResponse(overrides: Partial<BranchListResponse> = {}): BranchListResponse {
  return {
    data: [makeBranch()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BranchListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BranchListPage", () => {
  it("muestra Nombre y Zona horaria de cada sucursal, con el identificador IANA crudo", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeBranch({ id: "b1", name: "Casa Central", timezone: "America/Montevideo" }),
              // Una zona fuera de la lista de timezones.ts: se muestra igual, tal
              // cual está persistida.
              makeBranch({ id: "b2", name: "Sucursal Chuy", timezone: "UTC" }),
            ],
            pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
          }),
        ),
      ),
    );

    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(tabla.getByText("Casa Central")).toBeInTheDocument();
    expect(tabla.getByText("America/Montevideo")).toBeInTheDocument();
    expect(tabla.getByText("Sucursal Chuy")).toBeInTheDocument();
    expect(tabla.getByText("UTC")).toBeInTheDocument();
    expect(tabla.getByRole("columnheader", { name: "Zona horaria" })).toBeInTheDocument();
  });

  it("no gatea nada por rol: la pantalla entera es ADMIN-only por ruta", async () => {
    // Igual que SourceListPage: sin chequeo isAdmin, las acciones se ven
    // siempre. Quién puede entrar lo decide AdminRoute (ver el bloque del
    // final) y quién puede escribir, el backend.
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse())));
    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(screen.getByRole("link", { name: "Nueva sucursal" })).toHaveAttribute(
      "href",
      "/branches/new",
    );
    await openActionsMenu(userEvent.setup());
    expect(tabla.getByRole("menuitem", { name: "Editar" })).toHaveAttribute(
      "href",
      "/branches/b1/edit",
    );
    expect(tabla.getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("los filtros viajan en la query y la búsqueda resetea la página a 1", async () => {
    const urls: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Casa Central");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("page")).toBe("2"));

    await user.selectOptions(screen.getByLabelText("Ordenar por"), "name");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortBy")).toBe("name"));

    await user.selectOptions(screen.getByLabelText("Orden"), "asc");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortOrder")).toBe("asc"));

    await user.type(screen.getByLabelText("Buscar"), "chuy");
    await waitFor(() => {
      expect(urls.at(-1)?.searchParams.get("search")).toBe("chuy");
      expect(urls.at(-1)?.searchParams.get("page")).toBe("1");
    });
  });

  it("la paginación deshabilita Anterior en la primera página", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        ),
      ),
    );
    renderPage();

    await screen.findByText("Casa Central");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
  });

  describe("eliminar", () => {
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      confirmSpy = vi.spyOn(window, "confirm");
    });

    afterEach(() => {
      confirmSpy.mockRestore();
    });

    it("pide confirmación y NO llama al backend si se cancela", async () => {
      let llamadas = 0;
      server.use(
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () => {
          llamadas += 1;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(false);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Casa Central");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(confirmSpy).toHaveBeenCalledWith("¿Eliminar esta sucursal?");
      expect(llamadas).toBe(0);
    });

    it("confirmando manda el DELETE del id correcto", async () => {
      const borrados: string[] = [];
      server.use(
        http.get(baseUrl, () =>
          HttpResponse.json(listResponse({ data: [makeBranch({ id: "b9" })] })),
        ),
        http.delete(`${baseUrl}/:id`, ({ params }) => {
          borrados.push(params.id as string);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Casa Central");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      await waitFor(() => expect(borrados).toEqual(["b9"]));
    });

    it("el 400 del RESTRICT muestra el mensaje del backend tal cual, y la fila sigue ahí", async () => {
      // El backend no borra una sucursal con recursos/servicios/QRs activos o
      // con Google Calendar conectado: responde 400 con un texto escrito para
      // la persona. Ese texto es lo que se muestra — no se replica la regla
      // en el cliente.
      const mensaje =
        "No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.";
      server.use(
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () =>
          HttpResponse.json({ error: { message: mensaje } }, { status: 400 }),
        ),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Casa Central");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(mensaje);
      expect(screen.getByText("Casa Central")).toBeInTheDocument();
    });

    it("un DELETE fallido por otro motivo también muestra el mensaje del backend", async () => {
      server.use(
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () =>
          HttpResponse.json({ error: { message: "Sucursal no encontrada" } }, { status: 404 }),
        ),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Casa Central");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Sucursal no encontrada");
    });
  });

  it("estado de carga", () => {
    server.use(http.get(baseUrl, () => new Promise(() => undefined)));
    renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("estado de error, con el mensaje real del backend", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "Se rompió todo" } }, { status: 500 }),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Se rompió todo");
  });

  it("estado vacío", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText("No hay sucursales para mostrar.")).toBeInTheDocument();
  });
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// BranchListPage), con AppLayout y el destino del redirect reemplazados por
// placeholders — mismo criterio que auth/AdminRoute.test.tsx. Es lo que
// justifica que la página no tenga gate por rol propio.
function renderUnderAdminRoute(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/branches" element={<BranchListPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BranchListPage — bajo AdminRoute", () => {
  it("un USER entrando a /branches es redirigido y NO se pide GET /api/branches", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let llamadas = 0;
    server.use(
      http.get(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(listResponse());
      }),
    );

    renderUnderAdminRoute("/branches");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Sucursales" })).not.toBeInTheDocument();
    expect(llamadas).toBe(0);
  });

  it("un ADMIN sí ve la pantalla", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse())));

    renderUnderAdminRoute("/branches");

    expect(await screen.findByRole("heading", { name: "Sucursales" })).toBeInTheDocument();
    expect(await screen.findByText("Casa Central")).toBeInTheDocument();
  });
});
