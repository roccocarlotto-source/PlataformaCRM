import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { makeUser } from "../../test/userFixtures";
import { CompanyListPage } from "./CompanyListPage";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { CompanyListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: { id: "u1", email: "a@x.com", fullName: "A", organizationId: "org-1", role },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const baseUrl = `${env.apiUrl}/api/companies`;
const usersUrl = `${env.apiUrl}/api/users`;

// Solo para tests con rol ADMIN: useOwnerNames(isAdmin) dispara GET /api/users
// cuando isAdmin es true (ver relationResolution.ts). Los tests con rol USER
// deliberadamente NO incluyen este handler — que la request no exista es parte
// de lo que prueban. Mismo criterio que OpportunityListPage.test.tsx.
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CompanyListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CompanyListPage", () => {
  it("C.10 USER no ve Nueva empresa / Editar / Eliminar", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    const listResponse: CompanyListResponse = {
      data: [makeCompany()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(http.get(baseUrl, () => HttpResponse.json(listResponse)));

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.queryByText("Nueva empresa")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
  });

  it("C.11 ADMIN sí ve Nueva empresa / Editar / Eliminar", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: CompanyListResponse = {
      data: [makeCompany()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(
      usersHandler(),
      http.get(baseUrl, () => HttpResponse.json(listResponse)),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.getByText("Nueva empresa")).toBeInTheDocument();
    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("Eliminar")).toBeInTheDocument();
  });

  it("C.12 error de listado se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(baseUrl, () => HttpResponse.json({ error: { message: "boom" } }, { status: 500 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("C.13 empty state cuando data está vacía", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: CompanyListResponse = {
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    };
    server.use(
      usersHandler(),
      http.get(baseUrl, () => HttpResponse.json(listResponse)),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay empresas para mostrar.")).toBeInTheDocument(),
    );
  });

  it("C.14 search/industry/orden/paginación producen la query esperada", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    const listResponse: CompanyListResponse = {
      data: [makeCompany()],
      pagination: { page: 1, pageSize: 20, total: 100, totalPages: 5 },
    };
    server.use(
      usersHandler(),
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json(listResponse);
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    await user.type(screen.getByPlaceholderText("Buscar por nombre"), "acme");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("search")).toBe("acme"));

    await user.type(screen.getByPlaceholderText("Filtrar por industria"), "tech");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("industry")).toBe("tech"));

    await user.selectOptions(screen.getByLabelText("Ordenar por"), "name");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("sortBy")).toBe("name"));

    await user.click(screen.getByText("Siguiente"));
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("page")).toBe("2"));
  });

  it("C.15 cancelar window.confirm no envía DELETE", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: CompanyListResponse = {
      data: [makeCompany()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    let deleteCalled = false;
    server.use(
      usersHandler(),
      http.get(baseUrl, () => HttpResponse.json(listResponse)),
      http.delete(`${baseUrl}/:id`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteCalled).toBe(false);
  });

  it("C.16 confirmar window.confirm envía DELETE al id correcto y el flujo exitoso termina correctamente", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: CompanyListResponse = {
      data: [makeCompany({ id: "c-target" })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    let deletedId: string | undefined;
    server.use(
      usersHandler(),
      http.get(baseUrl, () => HttpResponse.json(listResponse)),
      http.delete(`${baseUrl}/:id`, ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    await waitFor(() => expect(deletedId).toBe("c-target"));
    // Flujo exitoso: sin mensaje de error de delete visible.
    expect(screen.queryByText(/no pudimos eliminar/i)).not.toBeInTheDocument();
  });

  it("C.17 DELETE fallido muestra un error visible y accesible, sin ocultarlo", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: CompanyListResponse = {
      data: [makeCompany()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(
      usersHandler(),
      http.get(baseUrl, () => HttpResponse.json(listResponse)),
      http.delete(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no se pudo eliminar" } }, { status: 500 }),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no se pudo eliminar"));
  });

  // -------------------------------------------------------------------------
  // Columna Owner — el gap de M2 cerrado (ver CompanyListPage.tsx).
  // -------------------------------------------------------------------------

  it("ADMIN ve la columna Owner resuelta a fullName", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeCompany({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Owner")).toBeInTheDocument());
    await waitFor(() => {
      const fila = screen.getByText("Acme").closest("tr");
      expect(fila).toHaveTextContent("Ana Pérez");
    });
  });

  it("una empresa SIN propietario muestra el guion, no un ownerId crudo ni un nombre ajeno", async () => {
    // Caso que Opportunity no tiene y por eso no esta cubierto alla:
    // Company.ownerId es nullable. Sin el guard del render, esto entraria a
    // byId.get(null) y, peor, un cambio futuro descuidado podria mostrar el
    // primer nombre del mapa. Columnas: Nombre | Industria | Dominio | Owner |
    // Acciones.
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeCompany({ ownerId: null })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Owner")).toBeInTheDocument());
    const fila = screen.getByText("Acme").closest("tr");
    expect(fila?.querySelectorAll("td")[3]).toHaveTextContent("—");
    expect(fila).not.toHaveTextContent("Ana Pérez");
  });

  it("USER: no ve la columna Owner ni el ownerId crudo", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeCompany({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
  });

  it("USER: montar la pagina NO dispara ningun request a /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    // Contador explicito, no solo ausencia de handler: con
    // onUnhandledRequest:"error" una request no manejada deja la query en
    // error en silencio, sin fallar el test por si sola. La unica forma
    // confiable de probar "cero requests" es contarlas. Mismo criterio que
    // OpportunityListPage.test.tsx.
    let usersRequestCount = 0;
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeCompany({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.get(usersUrl, () => {
        usersRequestCount += 1;
        return HttpResponse.json({
          data: [makeUser({ id: "u1" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    // Margen para que un fetch indebido, si lo hubiera, alcance a dispararse.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(usersRequestCount).toBe(0);
  });
});
