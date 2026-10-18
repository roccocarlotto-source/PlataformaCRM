import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivityListItem } from "../../test/activityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makeUser } from "../../test/userFixtures";
import { ActivityFeed } from "./ActivityFeed";
import type { AuthContextValue } from "../../auth/AuthContext";

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
      email: "a@x.com",
      fullName: "Ana",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
      canUseInternalAgent: false,
    },
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

function renderFeed() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ActivityFeed />
    </QueryClientProvider>,
  );
}

function card() {
  return screen.getByLabelText("Actividad reciente");
}

function activitiesResponse(data: ReturnType<typeof makeActivityListItem>[]) {
  return HttpResponse.json({
    data,
    pagination: { page: 1, pageSize: 8, total: data.length, totalPages: data.length ? 1 : 0 },
  });
}

// Desde el ensayo del 2026-10-17 el contacto y la oportunidad vienen en cada
// fila del listado: estos GET por id quedan solo para contar que no se piden.
const pedidosPorId = { contactos: 0, oportunidades: 0 };

function resolutionHandlers() {
  pedidosPorId.contactos = 0;
  pedidosPorId.oportunidades = 0;
  return [
    http.get(`${companiesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makeCompany({ id: params.id as string, name: "Acme Corp" })),
    ),
    http.get(`${contactsUrl}/:id`, ({ params }) => {
      pedidosPorId.contactos += 1;
      return HttpResponse.json(
        makeContact({ id: params.id as string, firstName: "Otro", lastName: "Nombre" }),
      );
    }),
    http.get(`${opportunitiesUrl}/:id`, ({ params }) => {
      pedidosPorId.oportunidades += 1;
      return HttpResponse.json(makeOpportunity({ id: params.id as string, title: "Otra" }));
    }),
  ];
}

const CREATED_AT = "2026-03-10T14:30:00.000Z";

describe("ActivityFeed", () => {
  it("ADMIN: pide las últimas 8 por occurredAt desc (cuándo pasó) sin filtros, y muestra tipo, asunto, relaciones resueltas, autor y fecha", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URLSearchParams[] = [];
    server.use(
      http.get(activitiesUrl, ({ request }) => {
        captured.push(new URL(request.url).searchParams);
        return activitiesResponse([
          makeActivityListItem({
            id: "a1",
            type: "CALL",
            subject: "Llamada de seguimiento",
            authorId: "u2",
            companyId: "co1",
            contactId: "ct1",
            opportunityId: "op1",
            contact: { id: "ct1", firstName: "Juan", lastName: "Pérez" },
            opportunity: { id: "op1", title: "Renovación anual" },
            occurredAt: CREATED_AT,
            createdAt: CREATED_AT,
          }),
          makeActivityListItem({
            id: "a2",
            type: "NOTE",
            subject: "Nota interna",
            authorId: "u1",
            companyId: "co1",
            occurredAt: CREATED_AT,
            createdAt: CREATED_AT,
          }),
        ]);
      }),
      ...resolutionHandlers(),
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "u2", fullName: "Bruno Díaz" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    renderFeed();

    await waitFor(() =>
      expect(within(card()).getByText("Llamada de seguimiento")).toBeInTheDocument(),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.get("sortBy")).toBe("occurredAt");
    expect(captured[0]?.get("sortOrder")).toBe("desc");
    expect(captured[0]?.get("pageSize")).toBe("8");
    expect(captured[0]?.has("assigneeId")).toBe(false);
    expect(captured[0]?.has("authorId")).toBe(false);
    expect(captured[0]?.has("completed")).toBe(false);

    const row1 = within(card()).getByText("Llamada de seguimiento").closest("li");
    expect(row1).not.toBeNull();
    expect(within(row1 as HTMLElement).getByText("Llamada")).toHaveClass("ds-badge");
    await waitFor(() =>
      expect(row1).toHaveTextContent("Acme Corp · Juan Pérez · Renovación anual · por Bruno Díaz"),
    );
    expect(row1).toHaveTextContent(new Date(CREATED_AT).toLocaleString());

    const row2 = within(card()).getByText("Nota interna").closest("li");
    expect(row2).toHaveTextContent("Acme Corp · por Vos");

    expect(within(card()).queryByText("co1")).not.toBeInTheDocument();
    expect(within(card()).queryByText("u2")).not.toBeInTheDocument();
    // Los nombres salieron de la fila: ningún GET por contacto ni por oportunidad.
    expect(pedidosPorId).toEqual({ contactos: 0, oportunidades: 0 });
  });

  it("un contacto o una oportunidad borrados (null en la fila) se muestran como —", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(activitiesUrl, () =>
        activitiesResponse([
          makeActivityListItem({
            id: "a1",
            subject: "Con borrados",
            authorId: "u1",
            companyId: null,
            contactId: "ct-borrado",
            opportunityId: "op-borrada",
            contact: null,
            opportunity: null,
          }),
        ]),
      ),
      ...resolutionHandlers(),
    );
    renderFeed();

    await waitFor(() => expect(within(card()).getByText("Con borrados")).toBeInTheDocument());
    expect(within(card()).getByText("Con borrados").closest("li")).toHaveTextContent(
      "— · — · por Vos",
    );
    expect(pedidosPorId).toEqual({ contactos: 0, oportunidades: 0 });
  });

  it("USER: nunca pide GET /api/users; su propio id es 'Vos' y uno ajeno un guion", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let usersRequests = 0;
    server.use(
      http.get(activitiesUrl, () =>
        activitiesResponse([
          makeActivityListItem({ id: "a1", subject: "Mía", authorId: "u1", companyId: "co1" }),
          makeActivityListItem({ id: "a2", subject: "Ajena", authorId: "u9", companyId: "co1" }),
        ]),
      ),
      ...resolutionHandlers(),
      http.get(usersUrl, () => {
        usersRequests += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
    );
    renderFeed();

    await waitFor(() => expect(within(card()).getByText("Mía")).toBeInTheDocument());
    expect(within(card()).getByText("Mía").closest("li")).toHaveTextContent("por Vos");
    expect(within(card()).getByText("Ajena").closest("li")).toHaveTextContent("por —");
    expect(usersRequests).toBe(0);
  });

  it("loading, empty y error", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(http.get(activitiesUrl, () => activitiesResponse([])));
    renderFeed();
    expect(within(card()).getByText("Cargando…")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(card()).getByText("Todavía no hay actividades.")).toBeInTheDocument(),
    );

    server.use(
      http.get(activitiesUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );
    renderFeed();
    await waitFor(() =>
      expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
        "No pudimos cargar la actividad reciente: caída",
      ),
    );
  });
});
