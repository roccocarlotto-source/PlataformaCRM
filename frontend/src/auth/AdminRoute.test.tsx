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
import { AdminRoute } from "./AdminRoute";
import { ProtectedRoute } from "./ProtectedRoute";
import { CompanyFormPage } from "../features/company/CompanyFormPage";
import { ContactFormPage } from "../features/contact/ContactFormPage";
import { PipelineFormPage } from "../features/pipeline/PipelineFormPage";
import { StageFormPage } from "../features/stage/StageFormPage";
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

const baseUrl = `${env.apiUrl}/companies`;

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
const contactsUrl = `${env.apiUrl}/contacts`;

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
const pipelinesUrl = `${env.apiUrl}/pipelines`;

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
const stagesUrl = `${env.apiUrl}/stages`;

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
