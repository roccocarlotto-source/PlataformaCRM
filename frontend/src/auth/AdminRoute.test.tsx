import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { env } from "../config/env";
import { makeCompany } from "../test/companyFixtures";
import { makeContact } from "../test/contactFixtures";
import { makePipeline } from "../test/pipelineFixtures";
import { makeStage } from "../test/stageFixtures";
import { makeOpportunity } from "../test/opportunityFixtures";
import { makeUser } from "../test/userFixtures";
import { AdminRoute } from "./AdminRoute";
import { ProtectedRoute } from "./ProtectedRoute";
import { CompanyFormPage } from "../features/company/CompanyFormPage";
import { ContactFormPage } from "../features/contact/ContactFormPage";
import { PipelineFormPage } from "../features/pipeline/PipelineFormPage";
import { StageFormPage } from "../features/stage/StageFormPage";
import { OpportunityFormPage } from "../features/opportunity/OpportunityFormPage";
import { ActivityFormPage } from "../features/activity/ActivityFormPage";
import { makeActivity } from "../test/activityFixtures";
import { UserListPage } from "../features/user/UserListPage";
import { InvitationListPage } from "../features/invitation/InvitationListPage";
import { InvitationFormPage } from "../features/invitation/InvitationFormPage";
import { makeInvitation } from "../test/invitationFixtures";
import type { AuthContextValue } from "./AuthContext";

// Ejercita la jerarquía real de routing (ProtectedRoute → AdminRoute →
// CompanyFormPage), no una condición aislada mockeando CompanyFormPage —
// mismo criterio que el escenario 14 de LoginPage.test.tsx.
vi.mock("./getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("./AuthContext", () => ({ useAuth: useAuthMock }));

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

// Misma forma de árbol que app/router.tsx bajo /companies — solo se
// sustituye AppLayout/CompanyListPage por placeholders mínimos, ya que lo
// que se está probando es la restricción ADMIN, no esos componentes (ya
// tienen su propia cobertura).
function renderAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/companies/new" element={<CompanyFormPage />} />
              <Route path="/companies/:id/edit" element={<CompanyFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de rutas de escritura de Company", () => {
  it("USER entrando directamente a /companies/new no renderiza el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderAt("/companies/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Nueva empresa")).not.toBeInTheDocument();
  });

  it("USER entrando directamente a /companies/:id/edit no renderiza el formulario ni pide el detail", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let detailRequested = false;
    server.use(
      http.get(`${baseUrl}/:id`, () => {
        detailRequested = true;
        return HttpResponse.json(makeCompany());
      }),
    );

    renderAt("/companies/c1/edit");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Editar empresa")).not.toBeInTheDocument();
    expect(detailRequested).toBe(false);
  });

  it("ADMIN sí accede a /companies/new", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));

    renderAt("/companies/new");

    await waitFor(() => expect(screen.getByText("Nueva empresa")).toBeInTheDocument());
  });

  it("ADMIN sí accede a /companies/:id/edit", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeCompany())));

    renderAt("/companies/c1/edit");

    await waitFor(() => expect(screen.getByText("Editar empresa")).toBeInTheDocument());
  });
});

// Mismo árbol de árbitro de decisión (un único AdminRoute cubre ambos
// features en app/router.tsx real) — confirma el wiring específico de
// Contact, no solo el mecanismo genérico ya probado arriba.
const contactsUrl = `${env.apiUrl}/api/contacts`;

function renderContactRouteAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route path="/contacts" element={<div>lista de contactos</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/contacts/new" element={<ContactFormPage />} />
              <Route path="/contacts/:id/edit" element={<ContactFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de rutas de escritura de Contact", () => {
  // AdminRoute redirige siempre a /companies (hardcoded, definido para
  // Company en M2 — no se modifica en M3, solo se reutiliza tal cual). Un
  // USER bloqueado en /contacts/new termina en el listado de empresas, no
  // en el de contactos; se prueba el comportamiento real, no uno deseado.
  it("USER entrando directamente a /contacts/new no renderiza el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderContactRouteAt("/contacts/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Nuevo contacto")).not.toBeInTheDocument();
  });

  it("USER entrando directamente a /contacts/:id/edit no renderiza el formulario ni pide el detail", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let detailRequested = false;
    server.use(
      http.get(`${contactsUrl}/:id`, () => {
        detailRequested = true;
        return HttpResponse.json(makeContact());
      }),
    );

    renderContactRouteAt("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Editar contacto")).not.toBeInTheDocument();
    expect(detailRequested).toBe(false);
  });

  it("ADMIN sí accede a /contacts/new", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));

    renderContactRouteAt("/contacts/new");

    await waitFor(() => expect(screen.getByText("Nuevo contacto")).toBeInTheDocument());
  });

  it("ADMIN sí accede a /contacts/:id/edit", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(http.get(`${contactsUrl}/:id`, () => HttpResponse.json(makeContact())));

    renderContactRouteAt("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByText("Editar contacto")).toBeInTheDocument());
  });
});

// Mismo árbitro de decisión (AdminRoute cubre también las rutas de
// escritura de Pipeline en app/router.tsx real) — confirma el wiring
// específico de Pipeline, no solo el mecanismo genérico.
const pipelinesUrl = `${env.apiUrl}/api/pipelines`;

function renderPipelineRouteAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route path="/pipelines" element={<div>lista de pipelines</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/pipelines/new" element={<PipelineFormPage />} />
              <Route path="/pipelines/:id/edit" element={<PipelineFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de rutas de escritura de Pipeline", () => {
  it("USER entrando directamente a /pipelines/new no renderiza el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderPipelineRouteAt("/pipelines/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Nuevo pipeline")).not.toBeInTheDocument();
  });

  it("USER entrando directamente a /pipelines/:id/edit no renderiza el formulario ni pide el detail", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let detailRequested = false;
    server.use(
      http.get(`${pipelinesUrl}/:id`, () => {
        detailRequested = true;
        return HttpResponse.json(makePipeline());
      }),
    );

    renderPipelineRouteAt("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Editar pipeline")).not.toBeInTheDocument();
    expect(detailRequested).toBe(false);
  });

  it("ADMIN sí accede a /pipelines/new", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));

    renderPipelineRouteAt("/pipelines/new");

    await waitFor(() => expect(screen.getByText("Nuevo pipeline")).toBeInTheDocument());
  });

  it("ADMIN sí accede a /pipelines/:id/edit", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(http.get(`${pipelinesUrl}/:id`, () => HttpResponse.json(makePipeline())));

    renderPipelineRouteAt("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByText("Editar pipeline")).toBeInTheDocument());
  });
});

// Mismo árbitro de decisión, ahora para las rutas de escritura de Stage
// (anidadas bajo /pipelines/:pipelineId/stages en app/router.tsx real).
const stagesUrl = `${env.apiUrl}/api/stages`;

function renderStageRouteAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server.use(http.get(`${pipelinesUrl}/:id`, () => HttpResponse.json(makePipeline())));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route path="/pipelines/:pipelineId/stages" element={<div>lista de etapas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/pipelines/:pipelineId/stages/new" element={<StageFormPage />} />
              <Route
                path="/pipelines/:pipelineId/stages/:stageId/edit"
                element={<StageFormPage />}
              />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de rutas de escritura de Stage", () => {
  it("USER entrando directamente a /pipelines/:pipelineId/stages/new no renderiza el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderStageRouteAt("/pipelines/pl1/stages/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Nueva etapa")).not.toBeInTheDocument();
  });

  it("USER entrando directamente a /pipelines/:pipelineId/stages/:stageId/edit no renderiza el formulario ni pide el detail", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let detailRequested = false;
    server.use(
      http.get(`${stagesUrl}/:id`, () => {
        detailRequested = true;
        return HttpResponse.json(makeStage());
      }),
    );

    renderStageRouteAt("/pipelines/pl1/stages/st1/edit");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Editar etapa")).not.toBeInTheDocument();
    expect(detailRequested).toBe(false);
  });

  it("ADMIN sí accede a /pipelines/:pipelineId/stages/new", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));

    renderStageRouteAt("/pipelines/pl1/stages/new");

    await waitFor(() => expect(screen.getByText("Nueva etapa")).toBeInTheDocument());
  });

  it("ADMIN sí accede a /pipelines/:pipelineId/stages/:stageId/edit", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(http.get(`${stagesUrl}/:id`, () => HttpResponse.json(makeStage())));

    renderStageRouteAt("/pipelines/pl1/stages/st1/edit");

    await waitFor(() => expect(screen.getByText("Editar etapa")).toBeInTheDocument());
  });
});

// Mismo árbitro de decisión, ahora para las rutas de escritura de
// Opportunity (M5) — un USER bloqueado en /opportunities/new NUNCA debe
// disparar GET /pipelines ni GET /api/users (los dispararía OpportunityFormPage
// si llegara a montarse): se verifica con onUnhandledRequest:"error" del
// lado de MSW (test/setup.ts) — si el form se montara igual, la ausencia
// deliberada de esos handlers haría fallar el test ruidosamente.
const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;

function renderOpportunityRouteAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route path="/opportunities" element={<div>lista de oportunidades</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/opportunities/new" element={<OpportunityFormPage />} />
              <Route path="/opportunities/:id/edit" element={<OpportunityFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de rutas de escritura de Opportunity", () => {
  it("USER entrando directamente a /opportunities/new no renderiza el formulario ni dispara GET /pipelines ni GET /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderOpportunityRouteAt("/opportunities/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Nueva oportunidad")).not.toBeInTheDocument();
  });

  it("USER entrando directamente a /opportunities/:id/edit no renderiza el formulario ni pide el detail", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let detailRequested = false;
    server.use(
      http.get(`${opportunitiesUrl}/:id`, () => {
        detailRequested = true;
        return HttpResponse.json(makeOpportunity());
      }),
    );

    renderOpportunityRouteAt("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Editar oportunidad")).not.toBeInTheDocument();
    expect(detailRequested).toBe(false);
  });

  it("ADMIN sí accede a /opportunities/new", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(pipelinesUrl, () =>
        HttpResponse.json({
          data: [makePipeline()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(`${env.apiUrl}/api/users`, () =>
        HttpResponse.json({
          data: [makeUser()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderOpportunityRouteAt("/opportunities/new");

    await waitFor(() => expect(screen.getByText("Nueva oportunidad")).toBeInTheDocument());
  });

  it("ADMIN sí accede a /opportunities/:id/edit", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(`${opportunitiesUrl}/:id`, () => HttpResponse.json(makeOpportunity())),
      http.get(pipelinesUrl, () =>
        HttpResponse.json({
          data: [makePipeline()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [makeStage()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(`${env.apiUrl}/api/users`, () =>
        HttpResponse.json({
          data: [makeUser()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderOpportunityRouteAt("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByText("Editar oportunidad")).toBeInTheDocument());
  });
});

// Mismo árbitro de decisión, ahora para las rutas de escritura de Activity
// (M6) — a diferencia de todos los bloques anteriores, /activities (listado,
// lectura) NO va detrás de AdminRoute en app/router.tsx real (GET
// /api/activities es abierto a cualquier rol) — solo /activities/new y
// /activities/:id/edit sí. Confirma el wiring específico de Activity, no
// solo el mecanismo genérico.
const activitiesUrl = `${env.apiUrl}/api/activities`;

function renderActivityRouteAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route path="/activities" element={<div>lista de actividades</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/activities/new" element={<ActivityFormPage />} />
              <Route path="/activities/:id/edit" element={<ActivityFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de rutas de escritura de Activity", () => {
  it("USER entrando directamente a /activities/new no renderiza el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderActivityRouteAt("/activities/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Nueva actividad")).not.toBeInTheDocument();
  });

  it("USER entrando directamente a /activities/:id/edit no renderiza el formulario ni pide el detail", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let detailRequested = false;
    server.use(
      http.get(`${activitiesUrl}/:id`, () => {
        detailRequested = true;
        return HttpResponse.json(makeActivity());
      }),
    );

    renderActivityRouteAt("/activities/act1/edit");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Editar actividad")).not.toBeInTheDocument();
    expect(detailRequested).toBe(false);
  });

  it("ADMIN sí accede a /activities/new", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(`${env.apiUrl}/api/users`, () =>
        HttpResponse.json({
          data: [makeUser()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderActivityRouteAt("/activities/new");

    await waitFor(() => expect(screen.getByText("Nueva actividad")).toBeInTheDocument());
  });

  it("ADMIN sí accede a /activities/:id/edit", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(`${activitiesUrl}/:id`, () => HttpResponse.json(makeActivity())),
      http.get(`${env.apiUrl}/api/users`, () =>
        HttpResponse.json({
          data: [makeUser()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderActivityRouteAt("/activities/act1/edit");

    await waitFor(() => expect(screen.getByText("Editar actividad")).toBeInTheDocument());
  });
});

// M7 — a diferencia de todos los bloques anteriores (incluido Activity),
// /users es TAMBIÉN ADMIN-only para lectura (GET /api/users, ver
// user.routes.ts) — no hay una lista abierta fuera del AdminRoute que
// probar acá, la propia UserListPage va adentro.
const usersUrl = `${env.apiUrl}/api/users`;

function renderUserRouteAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/users" element={<UserListPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de /users (lectura también ADMIN-only)", () => {
  it("USER entrando directamente a /users no renderiza la lista ni dispara GET /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let usersRequested = false;
    server.use(
      http.get(usersUrl, () => {
        usersRequested = true;
        return HttpResponse.json({
          data: [makeUser()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );

    renderUserRouteAt("/users");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
    expect(usersRequested).toBe(false);
  });

  it("ADMIN sí accede a /users", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser({ fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderUserRouteAt("/users");

    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
  });
});

// M7 — mismo criterio: GET /api/invitations es ADMIN-only, sin lista
// abierta fuera del AdminRoute.
const invitationsUrl = `${env.apiUrl}/api/invitations`;

function renderInvitationRouteAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/invitations" element={<InvitationListPage />} />
              <Route path="/invitations/new" element={<InvitationFormPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminRoute — protección visual de /invitations e /invitations/new (lectura también ADMIN-only)", () => {
  it("USER entrando directamente a /invitations no renderiza la lista ni dispara GET /api/invitations", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let invitationsRequested = false;
    server.use(
      http.get(invitationsUrl, () => {
        invitationsRequested = true;
        return HttpResponse.json({
          data: [makeInvitation()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );

    renderInvitationRouteAt("/invitations");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(invitationsRequested).toBe(false);
  });

  it("USER entrando directamente a /invitations/new no renderiza el formulario", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));

    renderInvitationRouteAt("/invitations/new");

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(screen.queryByText("Invitar")).not.toBeInTheDocument();
  });

  it("ADMIN sí accede a /invitations", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(invitationsUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ email: "invitado@example.com" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.get(usersUrl, () =>
        HttpResponse.json({
          data: [makeUser()],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderInvitationRouteAt("/invitations");

    await waitFor(() => expect(screen.getByText("invitado@example.com")).toBeInTheDocument());
  });

  it("ADMIN sí accede a /invitations/new", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));

    renderInvitationRouteAt("/invitations/new");

    await waitFor(() => expect(screen.getByText("Invitar")).toBeInTheDocument());
  });
});
