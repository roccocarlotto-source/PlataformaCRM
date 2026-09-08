import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthContextValue } from "./AuthContext";
import { PlatformAdminRoute } from "./PlatformAdminRoute";
import { ProtectedRoute } from "./ProtectedRoute";

vi.mock("./getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("./AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER", isPlatformAdmin: boolean): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

// Misma forma de árbol que app/router.tsx bajo /admin — la página real se
// sustituye por un placeholder: lo que se prueba es la restricción, no la
// página (tiene su propia cobertura en NewOrganizationPage.test.tsx).
function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>dashboard</div>} />
          <Route element={<PlatformAdminRoute />}>
            <Route path="/admin/organizations/new" element={<div>alta de organización</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlatformAdminRoute — protección visual de la herramienta de platform admin", () => {
  it("un ADMIN de organización que NO es platform admin rebota a '/'", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN", false));

    renderAt("/admin/organizations/new");

    await waitFor(() => expect(screen.getByText("dashboard")).toBeInTheDocument());
    expect(screen.queryByText("alta de organización")).not.toBeInTheDocument();
  });

  it("un USER que NO es platform admin rebota a '/'", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER", false));

    renderAt("/admin/organizations/new");

    await waitFor(() => expect(screen.getByText("dashboard")).toBeInTheDocument());
  });

  it("un platform admin accede, aunque su rol dentro de su organización sea USER — la allowlist es independiente del rol", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER", true));

    renderAt("/admin/organizations/new");

    await waitFor(() => expect(screen.getByText("alta de organización")).toBeInTheDocument());
  });
});
