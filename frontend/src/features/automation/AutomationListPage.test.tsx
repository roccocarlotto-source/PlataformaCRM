import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAutomation } from "../../test/automationFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { openActionsMenu } from "../../test/openActionsMenu";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AutomationListPage } from "./AutomationListPage";
import type { AutomationListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usan los casos de AdminRoute del final: la página en sí no consume
// useAuth (no tiene gate por rol, ver el comentario de AutomationListPage).
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

const baseUrl = `${env.apiUrl}/api/automations`;

function listResponse(overrides: Partial<AutomationListResponse> = {}): AutomationListResponse {
  return {
    data: [makeAutomation()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AutomationListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AutomationListPage", () => {
  it("muestra el nombre, el evento y la acción con su etiqueta legible, y el estado", async () => {
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse())));

    renderPage();

    const fila = (await screen.findByText("Seguimiento post-venta")).closest("tr");
    // La etiqueta del catálogo, no el string técnico que viaja por la API.
    expect(cellByHeader(fila, "Cuándo")).toHaveTextContent("Oportunidad ganada");
    expect(cellByHeader(fila, "Cuándo")).not.toHaveTextContent("opportunity.won");
    expect(cellByHeader(fila, "Qué hace")).toHaveTextContent("Crear actividad de seguimiento");
    expect(cellByHeader(fila, "Qué hace")).not.toHaveTextContent("activity.create_follow_up");
    expect(cellByHeader(fila, "Estado")?.querySelector(".ds-badge")).toHaveTextContent("Activa");
  });

  it("un trigger o una acción que el catálogo del frontend todavía no conoce se muestran crudos", async () => {
    // Es el caso de un backend que ya sumó un trigger o una acción y un
    // frontend desplegado antes: el dato real informa más que un "—".
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeAutomation({
                triggerType: "appointment.reminder_due",
                actionType: "whatsapp.send_message",
              }),
            ],
          }),
        ),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Seguimiento post-venta")).closest("tr");
    expect(cellByHeader(fila, "Cuándo")).toHaveTextContent("appointment.reminder_due");
    expect(cellByHeader(fila, "Qué hace")).toHaveTextContent("whatsapp.send_message");
  });

  it("una regla inactiva se muestra como tal, no como borrada", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({ data: [makeAutomation({ name: "Pausada", isActive: false })] }),
        ),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Pausada")).closest("tr");
    expect(cellByHeader(fila, "Estado")?.querySelector(".ds-badge")).toHaveTextContent("Inactiva");
  });

  it("no gatea nada por rol: la pantalla entera es ADMIN-only por ruta", async () => {
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse())));
    renderPage();

    const tabla = within(await screen.findByRole("table"));
    expect(screen.getByRole("link", { name: "Nueva automatización" })).toHaveAttribute(
      "href",
      "/automations/new",
    );
    await openActionsMenu(userEvent.setup());
    expect(tabla.getByRole("menuitem", { name: "Editar" })).toHaveAttribute(
      "href",
      "/automations/au1/edit",
    );
    expect(tabla.getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("los filtros viajan en la query y resetean la página a 1", async () => {
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
    await screen.findByText("Seguimiento post-venta");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("page")).toBe("2"));

    await user.type(screen.getByLabelText("Buscar"), "post-venta");
    await waitFor(() => {
      expect(urls.at(-1)?.searchParams.get("search")).toBe("post-venta");
      expect(urls.at(-1)?.searchParams.get("page")).toBe("1");
    });

    // "Inactivas" y no "Activas": false es el valor que un `if (query.isActive)`
    // se comería en el armado de la query.
    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Inactivas");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("isActive")).toBe("false"));

    await chooseSelectOption(user, screen.getByLabelText("Ordenar por"), "Nombre");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortBy")).toBe("name"));

    await chooseSelectOption(user, screen.getByLabelText("Orden"), "Ascendente");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("sortOrder")).toBe("asc"));
  });

  it("'Todas' en Estado saca el parámetro de la query, no manda isActive=''", async () => {
    const urls: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Seguimiento post-venta");

    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Activas");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("isActive")).toBe("true"));

    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Todas");
    await waitFor(() => expect(urls.at(-1)?.searchParams.has("isActive")).toBe(false));
  });

  it("no ofrece filtro por evento: con un solo trigger no podría filtrar nada", async () => {
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse())));
    renderPage();
    await screen.findByText("Seguimiento post-venta");

    expect(screen.queryByLabelText("Evento")).not.toBeInTheDocument();
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

    await screen.findByText("Seguimiento post-venta");
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
      await screen.findByText("Seguimiento post-venta");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      // El texto nombra la consecuencia que no se ve: deja de ejecutarse, y lo
      // que ya generó (las actividades creadas) queda donde está.
      expect(confirmSpy).toHaveBeenCalledWith(
        "¿Eliminar esta automatización? Deja de ejecutarse de inmediato; lo que ya generó no se toca.",
      );
      expect(llamadas).toBe(0);
    });

    it("confirmando manda el DELETE del id correcto", async () => {
      const borrados: string[] = [];
      server.use(
        http.get(baseUrl, () =>
          HttpResponse.json(listResponse({ data: [makeAutomation({ id: "au7" })] })),
        ),
        http.delete(`${baseUrl}/:id`, ({ params }) => {
          borrados.push(params.id as string);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Seguimiento post-venta");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      await waitFor(() => expect(borrados).toEqual(["au7"]));
    });

    it("un DELETE fallido muestra el mensaje del backend tal cual, y la fila sigue ahí", async () => {
      server.use(
        http.get(baseUrl, () => HttpResponse.json(listResponse())),
        http.delete(`${baseUrl}/:id`, () =>
          HttpResponse.json(
            { error: { message: "Automatización no encontrada" } },
            { status: 404 },
          ),
        ),
      );
      confirmSpy.mockReturnValue(true);

      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Seguimiento post-venta");
      await openActionsMenu(user);
      await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Automatización no encontrada");
      expect(screen.getByText("Seguimiento post-venta")).toBeInTheDocument();
    });
  });

  it("estado de carga", () => {
    server.use(http.get(baseUrl, () => new Promise(() => undefined)));
    renderPage();
    expect(screen.getAllByText("Cargando…").length).toBeGreaterThan(0);
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
    expect(await screen.findByText("No hay automatizaciones para mostrar.")).toBeInTheDocument();
  });
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// AutomationListPage), con AppLayout y el destino del redirect reemplazados
// por placeholders — mismo criterio que KnowledgeBaseListPage.test.tsx. Es lo
// que justifica que la página no tenga gate por rol propio.
function renderUnderAdminRoute(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/automations" element={<AutomationListPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AutomationListPage — bajo AdminRoute", () => {
  it("un USER entrando a /automations es redirigido y NO se pide GET /api/automations", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let llamadas = 0;
    server.use(
      http.get(baseUrl, () => {
        llamadas += 1;
        return HttpResponse.json(listResponse());
      }),
    );

    renderUnderAdminRoute("/automations");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Automatizaciones" })).not.toBeInTheDocument();
    expect(llamadas).toBe(0);
  });

  it("un ADMIN sí ve la pantalla", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse())));

    renderUnderAdminRoute("/automations");

    expect(await screen.findByRole("heading", { name: "Automatizaciones" })).toBeInTheDocument();
  });
});
