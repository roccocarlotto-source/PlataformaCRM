import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import type { AuthContextValue } from "../auth/AuthContext";

// Primer test de componente propio de AppLayout (gap heredado desde M2,
// ver M6 informe de deuda técnica) — se agrega ahora porque M7 introduce
// la primera rama de comportamiento condicional por rol en el nav
// (Usuarios/Invitaciones), que antes no existía.
vi.mock("../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

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

function renderLayout() {
  render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  );
}

describe("AppLayout — nav gateado por rol (M7)", () => {
  it("ADMIN ve los links de Usuarios e Invitaciones", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();

    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByText("Invitaciones")).toBeInTheDocument();
  });

  it("USER no ve los links de Usuarios ni Invitaciones", () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();

    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
    expect(screen.queryByText("Invitaciones")).not.toBeInTheDocument();
  });

  it("la navegación existente (Empresas/Contactos/Pipelines/Oportunidades/Actividades) sigue intacta para ambos roles", () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();

    expect(screen.getByText("Empresas")).toBeInTheDocument();
    expect(screen.getByText("Contactos")).toBeInTheDocument();
    expect(screen.getByText("Pipelines")).toBeInTheDocument();
    expect(screen.getByText("Oportunidades")).toBeInTheDocument();
    expect(screen.getByText("Actividades")).toBeInTheDocument();
  });

  it("'Mis tareas' se muestra para ambos roles: leer y completar lo propio es de cualquier rol", () => {
    for (const role of ["USER", "ADMIN"] as const) {
      useAuthMock.mockReturnValue(mockAuth(role));
      const { unmount } = render(
        <MemoryRouter>
          <AppLayout />
        </MemoryRouter>,
      );
      expect(screen.getByText("Mis tareas")).toHaveAttribute("href", "/tasks");
      unmount();
    }
  });

  it("muestra el nombre del usuario autenticado", () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    renderLayout();

    expect(screen.getByText("A")).toBeInTheDocument();
  });
});

describe("AppLayout — nav del módulo QR (Fase 3)", () => {
  it("el link QR se muestra para ambos roles: el listado es de lectura abierta", () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    renderLayout();
    expect(screen.getByRole("link", { name: "QR" })).toHaveAttribute("href", "/qr");
  });
});
