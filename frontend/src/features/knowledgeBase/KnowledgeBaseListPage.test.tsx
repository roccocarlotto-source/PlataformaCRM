import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeKnowledgeBaseEntry } from "../../test/knowledgeBaseFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { openActionsMenu } from "../../test/openActionsMenu";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { KnowledgeBaseListPage } from "./KnowledgeBaseListPage";
import type { KnowledgeBaseListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usan los casos de AdminRoute del final: la página en sí no consume
// useAuth (no tiene gate por rol, ver el comentario de KnowledgeBaseListPage).
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

const baseUrl = `${env.apiUrl}/api/knowledge-base`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function listResponse(
  overrides: Partial<KnowledgeBaseListResponse> = {},
): KnowledgeBaseListResponse {
  return {
    data: [makeKnowledgeBaseEntry()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

// La pantalla pide sucursales además de entradas: alimentan el filtro y la
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
        <KnowledgeBaseListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("KnowledgeBaseListPage", () => {
  it("muestra título, sucursal por nombre y estado — y NO el contenido", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeKnowledgeBaseEntry({
                id: "kb9",
                title: "Política de cancelación",
                branchId: "b2",
                content: "Se puede cancelar hasta 24 horas antes sin costo.",
              }),
            ],
          }),
        ),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Política de cancelación")).closest("tr");
    // La sucursal se muestra por NOMBRE, resuelta contra la misma lista que
    // alimenta el filtro — la respuesta de la entrada solo trae branchId.
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("Sucursal Chuy");
    expect(cellByHeader(fila, "Estado")?.querySelector(".ds-badge")).toHaveTextContent("Activa");
    // Sin columna de contenido: son hasta 10.000 caracteres y un recorte no
    // dice nada que el título no diga mejor.
    expect(screen.queryByText(/Se puede cancelar hasta 24 horas/)).not.toBeInTheDocument();
  });

  it("una entrada inactiva se muestra como tal, no como borrada", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [makeKnowledgeBaseEntry({ title: "Promo de invierno", isActive: false })],
          }),
        ),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Promo de invierno")).closest("tr");
    expect(cellByHeader(fila, "Estado")?.querySelector(".ds-badge")).toHaveTextContent("Inactiva");
  });

  it("una sucursal que no está en las primeras 100 se muestra como guion", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () =>
        HttpResponse.json(listResponse({ data: [makeKnowledgeBaseEntry({ branchId: "b-999" })] })),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Horarios de atención")).closest("tr");
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("—");
  });

  it("no gatea nada por rol: la pantalla entera es ADMIN-only por ruta", async () => {
    server.use(
      mockBranches(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
    );
    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(screen.getByRole("link", { name: "Nueva entrada" })).toHaveAttribute(
      "href",
      "/knowledge-base/new",
    );
    await openActionsMenu(userEvent.setup());
    expect(tabla.getByRole("menuitem", { name: "Editar" })).toHaveAttribute(
      "href",
      "/knowledge-base/kb1/edit",
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
    await screen.findByText("Horarios de atención");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("page")).toBe("2"));

    await user.type(screen.getByLabelText("Buscar"), "horarios");
    await waitFor(() => {
      expect(urls.at(-1)?.searchParams.get("search")).toBe("horarios");
      expect(urls.at(-1)?.searchParams.get("page")).toBe("1");
    });

    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Sucursal Chuy");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("branchId")).toBe("b2"));

    // "Inactivas" y no "Activas": false es el valor que un `if (query.isActive)`
    // se comería en el armado de la query.
    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Inactivas");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("isActive")).toBe("false"));

    await chooseSelectOption(user, screen.getByLabelText("Ordenar por"), "Título");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortBy")).toBe("title"));

    await chooseSelectOption(user, screen.getByLabelText("Orden"), "Ascendente");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortOrder")).toBe("asc"));
  });

  it("'Todas' en Estado saca el parámetro de la query, no manda isActive=''", async () => {
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
    await screen.findByText("Horarios de atención");

    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Activas");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("isActive")).toBe("true"));

    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Todas");
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

    await screen.findByText("Horarios de atención");
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
      await screen.findByText("Horarios de atención");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      // El texto nombra la consecuencia que no se ve en la pantalla: los
      // agentes de esa sucursal dejan de tener esa información.
      expect(confirmSpy).toHaveBeenCalledWith(
        "¿Eliminar esta entrada? Los agentes de esa sucursal dejan de usarla para responder.",
      );
      expect(llamadas).toBe(0);
    });

    it("confirmando manda el DELETE del id correcto", async () => {
      const borrados: string[] = [];
      server.use(
        mockBranches(),
        http.get(baseUrl, () =>
          HttpResponse.json(listResponse({ data: [makeKnowledgeBaseEntry({ id: "kb7" })] })),
        ),
        http.delete(`${baseUrl}/:id`, ({ params }) => {
          borrados.push(params.id as string);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Horarios de atención");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      await waitFor(() => expect(borrados).toEqual(["kb7"]));
    });

    it("un DELETE fallido muestra el mensaje del backend tal cual, y la fila sigue ahí", async () => {
      server.use(
        mockBranches(),
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () =>
          HttpResponse.json(
            { error: { message: "Entrada de la base de conocimiento no encontrada" } },
            { status: 404 },
          ),
        ),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Horarios de atención");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Entrada de la base de conocimiento no encontrada",
      );
      expect(screen.getByText("Horarios de atención")).toBeInTheDocument();
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
    expect(await screen.findByText("No hay entradas para mostrar.")).toBeInTheDocument();
  });
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// KnowledgeBaseListPage), con AppLayout y el destino del redirect reemplazados
// por placeholders — mismo criterio que AgentListPage.test.tsx. Es lo que
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
              <Route path="/knowledge-base" element={<KnowledgeBaseListPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("KnowledgeBaseListPage — bajo AdminRoute", () => {
  it("un USER entrando a /knowledge-base es redirigido y NO se pide GET /api/knowledge-base", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let llamadas = 0;
    server.use(
      mockBranches(),
      http.get(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(listResponse());
      }),
    );

    renderUnderAdminRoute("/knowledge-base");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Base de conocimiento" })).not.toBeInTheDocument();
    expect(llamadas).toBe(0);
  });

  it("un ADMIN sí ve la pantalla", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      mockBranches(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
    );

    renderUnderAdminRoute("/knowledge-base");

    expect(
      await screen.findByRole("heading", { name: "Base de conocimiento" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Horarios de atención")).toBeInTheDocument();
  });
});
