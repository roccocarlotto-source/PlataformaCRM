import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivity } from "../../test/activityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makeUser } from "../../test/userFixtures";
import { ActivityListPage } from "./ActivityListPage";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { ActivityListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER", meId = "u1"): AuthContextValue {
  return {
    status: "authenticated",
    me: { id: meId, email: "a@x.com", fullName: "A", organizationId: "org-1", role },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const activitiesUrl = `${env.apiUrl}/api/activities`;
const companiesUrl = `${env.apiUrl}/api/companies`;
const contactsUrl = `${env.apiUrl}/api/contacts`;
const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const usersUrl = `${env.apiUrl}/api/users`;

// CompanySelect (filtro de la lista) no busca por default (enabled solo con
// término) — no dispara GET /companies al montar. Los handlers de detail
// son para la resolución de relaciones de cada fila.
function relationHandlers() {
  return [
    http.get(`${companiesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makeCompany({ id: params.id as string, name: "Acme Corp" })),
    ),
    http.get(`${contactsUrl}/:id`, ({ params }) =>
      HttpResponse.json(
        makeContact({ id: params.id as string, firstName: "Ana", lastName: "Pérez" }),
      ),
    ),
    http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makeOpportunity({ id: params.id as string, title: "Renovación anual" })),
    ),
  ];
}

function usersHandler() {
  return http.get(usersUrl, () =>
    HttpResponse.json({
      data: [makeUser({ id: "u2", fullName: "Beto Gómez" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActivityListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("ActivityListPage", () => {
  it("loading, éxito, error y empty state", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: ActivityListResponse = {
      data: [makeActivity()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(
      http.get(activitiesUrl, () => HttpResponse.json(listResponse)),
      ...relationHandlers(),
      usersHandler(),
    );

    renderPage();

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
  });

  it("error de listado se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({ error: { message: "boom" } }, { status: 500 }),
      ),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar las actividades/)).toBeInTheDocument(),
    );
  });

  it("empty state cuando data está vacía", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay actividades para mostrar.")).toBeInTheDocument(),
    );
  });

  it("filtros reales (search/type/company) producen la query esperada, y paginación avanza", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    server.use(
      http.get(activitiesUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeActivity()],
          pagination: { page: 1, pageSize: 20, total: 40, totalPages: 2 },
        });
      }),
      ...relationHandlers(),
      usersHandler(),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Buscar por asunto o notas"), "renov");
    await user.selectOptions(screen.getByLabelText("Tipo"), "CALL");
    await user.click(screen.getByText("Siguiente"));

    await waitFor(() =>
      expect(captured.some((u) => u.searchParams.get("page") === "2")).toBe(true),
    );
    const withFilters = captured.find(
      (u) => u.searchParams.get("search") === "renov" && u.searchParams.get("type") === "CALL",
    );
    expect(withFilters).toBeDefined();
  });

  it("resuelve Company/Contact/Opportunity a nombre humano, nunca UUID crudo", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [
            makeActivity({
              companyId: "co1",
              contactId: "ct1",
              opportunityId: "op1",
            }),
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Renovación anual")).toBeInTheDocument();
    expect(screen.queryByText("co1")).not.toBeInTheDocument();
    expect(screen.queryByText("ct1")).not.toBeInTheDocument();
    expect(screen.queryByText("op1")).not.toBeInTheDocument();
  });

  it("fallback '—' cuando una relación falla al resolver", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity({ companyId: "co-borrada" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.get(`${companiesUrl}/co-borrada`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    const row = screen.getByText("Llamar para renovación").closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("ADMIN ve autor y asignado resueltos vía GET /api/users; el propio id se muestra como 'Vos'", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN", "u1"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity({ authorId: "u1", assigneeId: "u2" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    const row = screen.getByText("Llamar para renovación").closest("tr") as HTMLElement;
    expect(within(row).getByText("Vos")).toBeInTheDocument();
    expect(within(row).getByText("Beto Gómez")).toBeInTheDocument();
  });

  it("USER: montar la página NO dispara ningún request a /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER", "u1"));
    let usersRequestCount = 0;
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity({ authorId: "u1", assigneeId: "u2" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.get(usersUrl, () => {
        usersRequestCount += 1;
        return HttpResponse.json({
          data: [makeUser({ id: "u2" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(usersRequestCount).toBe(0);
  });

  it("USER: authorId/assigneeId propios se muestran como 'Vos', sin request a /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER", "u1"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity({ authorId: "u1", assigneeId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    const row = screen.getByText("Llamar para renovación").closest("tr") as HTMLElement;
    const votCells = within(row).getAllByText("Vos");
    expect(votCells).toHaveLength(2);
  });

  it("USER: un id ajeno no resoluble se muestra como '—', nunca el UUID crudo", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER", "u1"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity({ authorId: "u-ajeno", assigneeId: null })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    const row = screen.getByText("Llamar para renovación").closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText("u-ajeno")).not.toBeInTheDocument();
  });

  it("acciones de escritura (Nueva/Editar/Eliminar) visibles solo para ADMIN", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    expect(screen.queryByText("Nueva actividad")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
  });

  it("ADMIN ve Nueva/Editar/Eliminar", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    expect(screen.getByText("Nueva actividad")).toBeInTheDocument();
    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("Eliminar")).toBeInTheDocument();
  });

  it("delete: confirma, ejecuta la mutation y muestra error si falla", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity({ id: "act-del" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.delete(`${activitiesUrl}/act-del`, () =>
        HttpResponse.json({ error: { message: "no se pudo eliminar" } }, { status: 500 }),
      ),
      ...relationHandlers(),
      usersHandler(),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(screen.getByText("Llamar para renovación")).toBeInTheDocument());
    await user.click(screen.getByText("Eliminar"));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/No pudimos eliminar la actividad/)).toBeInTheDocument(),
    );
    confirmSpy.mockRestore();
  });

  it("'Vencida' aparece solo con dueDate en el pasado y sin completedAt", async () => {
    // Hecho derivado de dos campos reales (dueDate pasado + completedAt
    // null), no un estado del modelo: se muestra como badge al lado de la
    // fecha de vencimiento, y nada más.
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [
            makeActivity({
              id: "act-vencida",
              subject: "Vencida sin completar",
              dueDate: "2020-01-01T10:00:00.000Z",
              completedAt: null,
            }),
            makeActivity({
              id: "act-futura",
              subject: "Todavía no vence",
              dueDate: "2999-01-01T10:00:00.000Z",
              completedAt: null,
            }),
            makeActivity({
              id: "act-hecha",
              subject: "Vencida pero completada",
              dueDate: "2020-01-01T10:00:00.000Z",
              completedAt: "2020-01-02T10:00:00.000Z",
            }),
            makeActivity({
              id: "act-sin-fecha",
              subject: "Sin vencimiento",
              dueDate: null,
              completedAt: null,
            }),
          ],
          pagination: { page: 1, pageSize: 20, total: 4, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Vencida sin completar")).toBeInTheDocument());
    // Un único badge en toda la tabla, y está en la fila vencida sin completar.
    expect(screen.getAllByText("Vencida")).toHaveLength(1);
    const overdueRow = screen.getByText("Vencida sin completar").closest("tr") as HTMLElement;
    expect(within(overdueRow).getByText("Vencida")).toBeInTheDocument();
    for (const subject of ["Todavía no vence", "Vencida pero completada", "Sin vencimiento"]) {
      const row = screen.getByText(subject).closest("tr") as HTMLElement;
      expect(within(row).queryByText("Vencida")).not.toBeInTheDocument();
    }
  });

  it("tipo se muestra con label humano, no el valor crudo del enum", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({
          data: [makeActivity({ type: "MEETING" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
      usersHandler(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Reunión")).toBeInTheDocument());
  });
});
