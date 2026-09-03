import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeUser } from "../../test/userFixtures";
import { ContactListPage } from "./ContactListPage";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { ContactListResponse } from "./types";

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

const contactsUrl = `${env.apiUrl}/api/contacts`;
const companiesUrl = `${env.apiUrl}/api/companies`;
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
        <ContactListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Ubica la celda de una fila por el texto de su <th>, no por índice: el orden
// de columnas cambió al migrar al design system (Nombre | Empresa | Email |
// Teléfono | Etapa | Origen | Propietario | Acciones) y puede volver a
// cambiar sin que estas aserciones se rompan.
function cellByHeader(row: HTMLElement | null, header: string): HTMLElement | undefined {
  const headers = Array.from(row?.closest("table")?.querySelectorAll("th") ?? []).map((th) =>
    th.textContent?.trim(),
  );
  const index = headers.indexOf(header);
  return index === -1 ? undefined : row?.querySelectorAll("td")[index];
}

describe("ContactListPage", () => {
  it("loading, éxito, error y empty state", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: ContactListResponse = {
      data: [makeContact({ firstName: "Juana", lastName: "Pérez" })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(
      usersHandler(),
      http.get(contactsUrl, () => HttpResponse.json(listResponse)),
    );

    renderPage();

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
  });

  it("error de listado se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({ error: { message: "boom" } }, { status: 500 }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("empty state cuando data está vacía", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay contactos para mostrar.")).toBeInTheDocument(),
    );
  });

  it("search/lifecycleStage/orden/paginación producen la query esperada", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    const listResponse: ContactListResponse = {
      data: [makeContact()],
      pagination: { page: 1, pageSize: 20, total: 100, totalPages: 5 },
    };
    server.use(
      usersHandler(),
      http.get(contactsUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json(listResponse);
      }),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    await user.type(screen.getByPlaceholderText("Buscar por nombre o email"), "juana");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("search")).toBe("juana"));

    await user.selectOptions(screen.getByLabelText("Etapa"), "MQL");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("lifecycleStage")).toBe("MQL"));

    await user.selectOptions(screen.getByLabelText("Ordenar por"), "firstName");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("sortBy")).toBe("firstName"));

    await user.click(screen.getByText("Siguiente"));
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("page")).toBe("2"));
  });

  it("el filtro companyId (vía CompanySelect) produce la query esperada y puede limpiarse", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const capturedContacts: URL[] = [];
    server.use(
      usersHandler(),
      http.get(contactsUrl, ({ request }) => {
        capturedContacts.push(new URL(request.url));
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
      http.get(companiesUrl, () =>
        HttpResponse.json({
          data: [makeCompany({ id: "co-1", name: "Acme Corp" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(capturedContacts.length).toBeGreaterThan(0));

    await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), "acme");
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByText("Acme Corp"));

    await waitFor(() =>
      expect(capturedContacts.at(-1)?.searchParams.get("companyId")).toBe("co-1"),
    );

    await user.click(screen.getByText("Quitar filtro de empresa"));
    await waitFor(() => expect(capturedContacts.at(-1)?.searchParams.get("companyId")).toBeNull());
  });

  it("USER no ve Nuevo contacto / Editar / Eliminar", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
    expect(screen.queryByText("Nuevo contacto")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
  });

  it("ADMIN sí ve Nuevo contacto / Editar / Eliminar", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
    expect(screen.getByText("Nuevo contacto")).toBeInTheDocument();
    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("Eliminar")).toBeInTheDocument();
  });

  it("cancelar window.confirm no envía DELETE", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let deleteCalled = false;
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${contactsUrl}/:id`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteCalled).toBe(false);
  });

  it("confirmar window.confirm envía DELETE al id correcto", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let deletedId: string | undefined;
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact({ id: "ct-target" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${contactsUrl}/:id`, ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    await waitFor(() => expect(deletedId).toBe("ct-target"));
    expect(screen.queryByText(/no pudimos eliminar/i)).not.toBeInTheDocument();
  });

  it("DELETE fallido muestra un error visible y accesible", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${contactsUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no se pudo eliminar" } }, { status: 500 }),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no se pudo eliminar"));
  });

  it("resuelve el nombre de una Company que NO está en la primera página de Companies (bug corregido)", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let companiesListCalled = false;
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact({ companyId: "co-99" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      // La lista de Companies (paginada, primeras N) NUNCA incluye co-99 —
      // simula una organización con más Companies de las que trae una página.
      http.get(companiesUrl, () => {
        companiesListCalled = true;
        return HttpResponse.json({
          data: [makeCompany({ id: "co-1", name: "Otra SA" })],
          pagination: { page: 1, pageSize: 20, total: 200, totalPages: 10 },
        });
      }),
      // Resolución puntual: SÍ conoce a co-99.
      http.get(`${companiesUrl}/:id`, ({ params }) => {
        if (params.id === "co-99") {
          return HttpResponse.json(makeCompany({ id: "co-99", name: "Acme Fuera de Página" }));
        }
        return HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 });
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme Fuera de Página")).toBeInTheDocument());
    // La corrección depende de la resolución puntual, no de la lista paginada.
    expect(companiesListCalled).toBe(false);
  });

  it("IDs de Company duplicados entre Contacts no generan resolución duplicada", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let detailRequestCount = 0;
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [
            makeContact({ id: "ct-1", companyId: "co-1" }),
            makeContact({ id: "ct-2", firstName: "Otro", companyId: "co-1" }),
          ],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        }),
      ),
      http.get(`${companiesUrl}/:id`, () => {
        detailRequestCount += 1;
        return HttpResponse.json(makeCompany({ id: "co-1", name: "Acme Corp" }));
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getAllByText("Acme Corp")).toHaveLength(2));
    expect(detailRequestCount).toBe(1);
  });

  it("un fallo de resolución puntual de una Company no rompe el resto del listado", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [
            makeContact({ id: "ct-1", firstName: "Con", companyId: "co-rota" }),
            makeContact({ id: "ct-2", firstName: "Sin", companyId: null }),
          ],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        }),
      ),
      http.get(`${companiesUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Con Pérez")).toBeInTheDocument());
    expect(screen.getByText("Sin Pérez")).toBeInTheDocument();
    // Fallback explícito, nunca el UUID crudo ("co-rota").
    expect(screen.queryByText("co-rota")).not.toBeInTheDocument();
    // Se afirma sobre LA CELDA de Empresa, no con un getByText("—") suelto:
    // desde que existe la columna Propietario hay más de un "—" en la fila
    // (estas fixtures traen ownerId null), así que el assert viejo pasó a ser
    // ambiguo. La celda se ubica por su cabecera, no por índice.
    const filaRota = screen.getByText("Con Pérez").closest("tr");
    expect(cellByHeader(filaRota, "Empresa")).toHaveTextContent("—");
  });

  // -------------------------------------------------------------------------
  // Columna Propietario (owner) — el gap de M3 cerrado (ver ContactListPage.tsx).
  // -------------------------------------------------------------------------

  it("ADMIN ve la columna Propietario resuelta a fullName", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Propietario")).toBeInTheDocument());
    await waitFor(() => {
      const fila = screen.getByText("Juana Pérez").closest("tr");
      expect(fila).toHaveTextContent("Ana Pérez");
    });
  });

  it("un contacto SIN propietario muestra el guion, no un ownerId crudo ni un nombre ajeno", async () => {
    // Caso que Opportunity no tiene y por eso no esta cubierto alla:
    // Contact.ownerId es nullable. La celda se ubica por su cabecera, no por
    // índice.
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      usersHandler(),
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact({ ownerId: null })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Propietario")).toBeInTheDocument());
    const fila = screen.getByText("Juana Pérez").closest("tr");
    expect(cellByHeader(fila, "Propietario")).toHaveTextContent("—");
    expect(fila).not.toHaveTextContent("Ana Pérez");
  });

  it("USER: no ve la columna Propietario ni el ownerId crudo", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
    expect(screen.queryByText("Propietario")).not.toBeInTheDocument();
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
  });

  it("USER: montar la pagina NO dispara ningun request a /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    // Contador explicito, no solo ausencia de handler: con
    // onUnhandledRequest:"error" una request no manejada deja la query en
    // error en silencio, sin fallar el test por si sola. Mismo criterio que
    // OpportunityListPage.test.tsx.
    let usersRequestCount = 0;
    server.use(
      http.get(contactsUrl, () =>
        HttpResponse.json({
          data: [makeContact({ ownerId: "u1" })],
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

    await waitFor(() => expect(screen.getByText("Juana Pérez")).toBeInTheDocument());
    // Margen para que un fetch indebido, si lo hubiera, alcance a dispararse.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(usersRequestCount).toBe(0);
  });
});
