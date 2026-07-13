import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { env } from "../config/env";
import { makeCompany } from "../test/companyFixtures";
import { AdminRoute } from "./AdminRoute";
import { ProtectedRoute } from "./ProtectedRoute";
import { CompanyFormPage } from "../features/company/CompanyFormPage";
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
