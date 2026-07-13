import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue, AuthStatus } from "../../auth/AuthContext";

// Escenarios 3, 4 y 14 de la matriz STD-SW-003. useAuth se mockea acá (no
// AuthProvider completo): LoginPage/ProtectedRoute solo dependen del
// contrato AuthContextValue, no de cómo se resuelve — ese contrato ya está
// cubierto de punta a punta en auth/AuthContext.test.tsx.
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());

vi.mock("../../auth/AuthContext", () => ({
  useAuth: useAuthMock,
}));

function mockAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "unauthenticated" as AuthStatus,
    me: null,
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
    ...overrides,
  };
}

describe("LoginPage — escenarios STD-SW-003", () => {
  it("3. Login exitoso: submit llama a login() con los valores tipeados", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(mockAuth({ login }));

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "secret123");
    await user.click(screen.getByRole("button", { name: /ingresar/i }));

    expect(login).toHaveBeenCalledWith("a@example.com", "secret123");
  });

  it("3b. Con status=authenticated, LoginPage redirige a home sin navegación imperativa", () => {
    useAuthMock.mockReturnValue(mockAuth({ status: "authenticated" }));

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>home-ok</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("home-ok")).toBeInTheDocument();
  });

  it("4. Login fallido muestra el error real y reactiva el submit", async () => {
    const login = vi.fn().mockRejectedValue(new Error("Credenciales inválidas"));
    useAuthMock.mockReturnValue(mockAuth({ login }));

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "wrong");
    const submitButton = screen.getByRole("button", { name: /ingresar/i });
    await user.click(submitButton);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Credenciales inválidas"),
    );
    expect(submitButton).toBeEnabled();
  });

  it("14. ProtectedRoute preserva la ruta original y LoginPage redirige ahí tras el login", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(mockAuth({ status: "unauthenticated", login }));

    const user = userEvent.setup();
    // Función, no una constante JSX: rerender() necesita un árbol de
    // elementos NUEVO (referencia distinta) para que React vuelva a invocar
    // LoginPage/ProtectedRoute — con el mismo objeto JSX de siempre, React
    // hace bail-out por igualdad referencial y nunca los re-ejecuta.
    const buildUi = () => (
      <MemoryRouter initialEntries={["/companies/42"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/companies/:id" element={<div>detalle de compañía</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(buildUi());

    // ProtectedRoute, sin sesión, redirige a /login preservando location.state.from
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "secret123");
    await user.click(screen.getByRole("button", { name: /ingresar/i }));

    // Simula lo que el AuthContext real hace tras un SIGNED_IN: status pasa a
    // "authenticated" y todos los consumidores se re-renderizan. Acá useAuth
    // está mockeado (sin Provider real), así que se fuerza el mismo efecto
    // con un rerender explícito tras cambiar lo que devuelve el mock.
    useAuthMock.mockReturnValue(mockAuth({ status: "authenticated" }));
    rerender(buildUi());

    await waitFor(() =>
      expect(screen.getByText("detalle de compañía")).toBeInTheDocument(),
    );
  });
});
