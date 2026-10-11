import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthContextValue } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("./AuthContext", () => ({ useAuth: useAuthMock }));

function noActivada(debeAceptarInvitacion: boolean): AuthContextValue {
  return {
    status: "account-unavailable",
    me: null,
    accountUnavailableReason: "Tu cuenta todavía no está activada. Contactá a tu administrador.",
    debeAceptarInvitacion,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

function renderEn(ruta: string) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/invite/accept" element={<p>pantalla de aceptar</p>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<p>inicio</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// Prueba de la Clínica Demo (2026-10-11): el link del mail de una invitación
// dejaba a la persona en "/" con sesión y sin usuario, frente al aviso de
// "no activada" y sin forma de aceptar.
describe("ProtectedRoute: una sesión que viene de una invitación sin aceptar", () => {
  it("lleva a /invite/accept", () => {
    useAuthMock.mockReturnValue(noActivada(true));
    renderEn("/");
    expect(screen.getByText("pantalla de aceptar")).toBeInTheDocument();
    expect(screen.queryByText(/no está activada/)).not.toBeInTheDocument();
  });

  it("sin invitación pendiente, el aviso de siempre", () => {
    useAuthMock.mockReturnValue(noActivada(false));
    renderEn("/");
    expect(
      screen.getByText("Tu cuenta todavía no está activada. Contactá a tu administrador."),
    ).toBeInTheDocument();
    expect(screen.queryByText("pantalla de aceptar")).not.toBeInTheDocument();
  });
});
