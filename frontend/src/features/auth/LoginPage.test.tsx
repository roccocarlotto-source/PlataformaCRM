import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthApiError } from "@supabase/supabase-js";
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

    await waitFor(() => expect(screen.getByText("detalle de compañía")).toBeInTheDocument());
  });
});

// Una persona invitada que todavía no aceptó ingresa por /login: Supabase
// acepta la contraseña, pero /api/me da 403 porque todavía no tiene usuario.
// Antes el botón quedaba en "Ingresando…" para siempre, sin mensaje.
describe("LoginPage — después del login, el perfil no resuelve", () => {
  function buildUi() {
    return (
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invite/accept" element={<div>pantalla-aceptar-invitacion</div>} />
          <Route path="/" element={<div>home-ok</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  async function ingresar(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Email"), "invitado@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "secret123");
    await user.click(screen.getByRole("button", { name: /ingresar/i }));
  }

  it("403 con invitationId en la sesión: va a /invite/accept", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(mockAuth({ login }));
    const user = userEvent.setup();
    const { rerender } = render(buildUi());

    await ingresar(user);
    expect(screen.getByRole("button", { name: /ingresando/i })).toBeDisabled();

    useAuthMock.mockReturnValue(
      mockAuth({
        status: "account-unavailable",
        accountUnavailableReason:
          "Tu cuenta todavía no está activada. Contactá a tu administrador.",
        debeAceptarInvitacion: true,
        login,
      }),
    );
    rerender(buildUi());

    await waitFor(() =>
      expect(screen.getByText("pantalla-aceptar-invitacion")).toBeInTheDocument(),
    );
  });

  it("403 sin invitationId: muestra el motivo y libera el botón", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(mockAuth({ login }));
    const user = userEvent.setup();
    const { rerender } = render(buildUi());

    await ingresar(user);

    useAuthMock.mockReturnValue(
      mockAuth({
        status: "account-unavailable",
        accountUnavailableReason:
          "Tu cuenta todavía no está activada. Contactá a tu administrador.",
        debeAceptarInvitacion: false,
        login,
      }),
    );
    rerender(buildUi());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Tu cuenta todavía no está activada. Contactá a tu administrador.",
      ),
    );
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled();
  });

  it("cuenta desactivada: muestra el motivo específico del backend", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(mockAuth({ login }));
    const user = userEvent.setup();
    const { rerender } = render(buildUi());

    await ingresar(user);
    useAuthMock.mockReturnValue(
      mockAuth({
        status: "account-unavailable",
        accountUnavailableReason: "Tu cuenta fue desactivada.",
        login,
      }),
    );
    rerender(buildUi());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Tu cuenta fue desactivada."),
    );
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled();
  });

  it("profile-error: muestra el error con Reintentar y libera el botón", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const retryProfile = vi.fn();
    useAuthMock.mockReturnValue(mockAuth({ login, retryProfile }));
    const user = userEvent.setup();
    const { rerender } = render(buildUi());

    await ingresar(user);
    useAuthMock.mockReturnValue(
      mockAuth({
        status: "profile-error",
        profileError: new Error("Error del servidor"),
        login,
        retryProfile,
      }),
    );
    rerender(buildUi());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No pudimos verificar tu cuenta"),
    );
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retryProfile).toHaveBeenCalledTimes(1);
  });

  it("la sesión nunca llega a la pestaña: a los 10 s avisa y libera el botón", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const login = vi.fn().mockResolvedValue(undefined);
      useAuthMock.mockReturnValue(mockAuth({ login }));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(buildUi());

      await ingresar(user);
      expect(screen.getByRole("button", { name: /ingresando/i })).toBeDisabled();

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "No pudimos completar el ingreso. Intentá de nuevo.",
      );
      expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LoginPage — mensajes de Supabase en castellano", () => {
  function renderLogin() {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("credenciales inválidas de Supabase (en inglés) se muestran en castellano", async () => {
    const login = vi
      .fn()
      .mockRejectedValue(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"));
    useAuthMock.mockReturnValue(mockAuth({ login }));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "wrong");
    await user.click(screen.getByRole("button", { name: /ingresar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El email o la contraseña no son correctos.",
      ),
    );
    expect(screen.queryByText(/Invalid login credentials/)).not.toBeInTheDocument();
  });

  it("demasiados intentos (429 de Supabase) se muestra en castellano", async () => {
    const login = vi
      .fn()
      .mockRejectedValue(
        new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
      );
    useAuthMock.mockReturnValue(mockAuth({ login }));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "wrong");
    await user.click(screen.getByRole("button", { name: /ingresar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Demasiados intentos. Probá de nuevo en unos minutos.",
      ),
    );
  });
});

describe("LoginPage — automotora", () => {
  it("automotora sin cambios: un USER activo de una automotora ingresa y llega a /", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(mockAuth({ login }));
    const user = userEvent.setup();
    const buildUi = () => (
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invite/accept" element={<div>pantalla-aceptar-invitacion</div>} />
          <Route path="/" element={<div>home-ok</div>} />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(buildUi());

    await user.type(screen.getByLabelText("Email"), "vendedor@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "secret123");
    await user.click(screen.getByRole("button", { name: /ingresar/i }));

    useAuthMock.mockReturnValue(
      mockAuth({
        status: "authenticated",
        me: {
          id: "user-1",
          email: "vendedor@example.com",
          fullName: "Vendedor",
          organizationId: "org-1",
          role: "USER",
          isPlatformAdmin: false,
          canUseInternalAgent: false,
          industry: "AUTOMOTORA",
        },
        login,
      }),
    );
    rerender(buildUi());

    await waitFor(() => expect(screen.getByText("home-ok")).toBeInTheDocument());
    expect(screen.queryByText("pantalla-aceptar-invitacion")).not.toBeInTheDocument();
  });
});
