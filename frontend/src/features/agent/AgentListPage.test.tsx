import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAgent } from "../../test/agentFixtures";
import { makeBranch } from "../../test/branchFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { openActionsMenu } from "../../test/openActionsMenu";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AgentListPage } from "./AgentListPage";
import type { AgentListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usan los casos de AdminRoute del final: la página en sí no consume
// useAuth (no tiene gate por rol, ver el comentario de AgentListPage).
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

const baseUrl = `${env.apiUrl}/api/agents`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function listResponse(overrides: Partial<AgentListResponse> = {}): AgentListResponse {
  return {
    data: [makeAgent()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

// La pantalla pide sucursales además de agentes: alimentan el filtro y la
// resolución del nombre de la sucursal de cada fila, con una sola request
// (misma queryKey que BranchSelect).
function mockBranches() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch(), makeBranch({ id: "b2", name: "Sucursal Chuy" })],
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentListPage", () => {
  it("muestra nombre, sucursal por nombre, estado, canales y modelo", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeAgent({
                id: "ag1",
                name: "Asistente de ventas",
                branchId: "b2",
                channels: ["WHATSAPP", "WEB"],
                modelName: "openai/gpt-4o-mini",
              }),
            ],
          }),
        ),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Asistente de ventas")).closest("tr");
    // La sucursal se muestra por NOMBRE, resuelta contra la misma lista que
    // alimenta el filtro — la respuesta del agente solo trae branchId.
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("Sucursal Chuy");
    expect(cellByHeader(fila, "Estado")?.querySelector(".ds-badge")).toHaveTextContent("Activo");
    expect(cellByHeader(fila, "Canales")).toHaveTextContent("WhatsApp · Web");
    expect(cellByHeader(fila, "Modelo")).toHaveTextContent("OpenRouter · openai/gpt-4o-mini");
  });

  it("un agente inactivo, sin canales y con un proveedor fuera de la lista", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeAgent({
                name: "Agente pausado",
                isActive: false,
                channels: [],
                // Un adaptador que el backend podría agregar antes que esta
                // pantalla: se muestra crudo, no como "—".
                modelProvider: "anthropic",
              }),
            ],
          }),
        ),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Agente pausado")).closest("tr");
    expect(cellByHeader(fila, "Estado")?.querySelector(".ds-badge")).toHaveTextContent("Inactivo");
    expect(cellByHeader(fila, "Canales")).toHaveTextContent("—");
    expect(cellByHeader(fila, "Modelo")).toHaveTextContent("anthropic · openai/gpt-4o-mini");
  });

  it("una sucursal que no está en las primeras 100 se muestra como guion", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json(listResponse({ data: [makeAgent({ branchId: "b-999" })] })),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Asistente de ventas")).closest("tr");
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("—");
  });

  it("no gatea nada por rol: la pantalla entera es ADMIN-only por ruta", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
    );
    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(screen.getByRole("link", { name: "Nuevo agente" })).toHaveAttribute(
      "href",
      "/agents/new",
    );
    await openActionsMenu(userEvent.setup());
    expect(tabla.getByRole("menuitem", { name: "Editar" })).toHaveAttribute(
      "href",
      "/agents/ag1/edit",
    );
    expect(tabla.getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("los filtros viajan en la query y resetean la página a 1", async () => {
    const urls: URL[] = [];
    server.use(
      mockBranches(),
      http.get(baseUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Asistente de ventas");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("page")).toBe("2"));

    await user.type(screen.getByLabelText("Buscar"), "ventas");
    await waitFor(() => {
      expect(urls.at(-1)?.searchParams.get("search")).toBe("ventas");
      expect(urls.at(-1)?.searchParams.get("page")).toBe("1");
    });

    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("branchId")).toBe("b2"));

    // "Inactivos" y no "Activos": false es el valor que un `if (query.isActive)`
    // se comería en el armado de la query.
    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Inactivos");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("isActive")).toBe("false"));

    await chooseSelectOption(user, screen.getByLabelText("Ordenar por"), "Nombre");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortBy")).toBe("name"));

    await chooseSelectOption(user, screen.getByLabelText("Orden"), "Ascendente");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortOrder")).toBe("asc"));
  });

  it("'Todos' en Estado saca el parámetro de la query, no manda isActive=''", async () => {
    const urls: URL[] = [];
    server.use(
      mockBranches(),
      http.get(baseUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Asistente de ventas");

    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Activos");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("isActive")).toBe("true"));

    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Todos");
    await waitFor(() => expect(urls.at(-1)?.searchParams.has("isActive")).toBe(false));
  });

  it("la paginación deshabilita Anterior en la primera página", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        ),
      ),
    );
    renderPage();

    await screen.findByText("Asistente de ventas");
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
        mockBranches(),
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () => {
          llamadas += 1;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(false);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Asistente de ventas");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      // El texto nombra la consecuencia que no se ve en la pantalla: el
      // borrado revoca en cascada los tokens de embed del agente.
      expect(confirmSpy).toHaveBeenCalledWith(
        "¿Eliminar este agente? Deja de responder de inmediato y sus tokens de embed quedan revocados.",
      );
      expect(llamadas).toBe(0);
    });

    it("confirmando manda el DELETE del id correcto", async () => {
      const borrados: string[] = [];
      server.use(
        mockBranches(),
        http.get(baseUrl, () =>
          HttpResponse.json(listResponse({ data: [makeAgent({ id: "ag9" })] })),
        ),
        http.delete(`${baseUrl}/:id`, ({ params }) => {
          borrados.push(params.id as string);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Asistente de ventas");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      await waitFor(() => expect(borrados).toEqual(["ag9"]));
    });

    it("un DELETE fallido muestra el mensaje del backend tal cual, y la fila sigue ahí", async () => {
      server.use(
        mockBranches(),
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () =>
          HttpResponse.json({ error: { message: "Agente no encontrado" } }, { status: 404 }),
        ),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Asistente de ventas");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Agente no encontrado");
      expect(screen.getByText("Asistente de ventas")).toBeInTheDocument();
    });
  });

  it("estado de carga", () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () => new Promise(() => undefined)),
    );
    renderPage();
    expect(screen.getAllByText("Cargando…").length).toBeGreaterThan(0);
  });

  it("estado de error, con el mensaje real del backend", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "Se rompió todo" } }, { status: 500 }),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Se rompió todo");
  });

  it("estado vacío", async () => {
    server.use(
      mockBranches(),
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
    expect(await screen.findByText("No hay agentes para mostrar.")).toBeInTheDocument();
  });
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// AgentListPage), con AppLayout y el destino del redirect reemplazados por
// placeholders — mismo criterio que BranchListPage.test.tsx. Es lo que
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
              <Route path="/agents" element={<AgentListPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentListPage — bajo AdminRoute", () => {
  it("un USER entrando a /agents es redirigido y NO se pide GET /api/agents", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let llamadas = 0;
    server.use(
      mockBranches(),
      http.get(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(listResponse());
      }),
    );

    renderUnderAdminRoute("/agents");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Agentes de IA" })).not.toBeInTheDocument();
    expect(llamadas).toBe(0);
  });

  it("un ADMIN sí ve la pantalla", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      mockBranches(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
    );

    renderUnderAdminRoute("/agents");

    expect(await screen.findByRole("heading", { name: "Agentes de IA" })).toBeInTheDocument();
    expect(await screen.findByText("Asistente de ventas")).toBeInTheDocument();
  });
});
