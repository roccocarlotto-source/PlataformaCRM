import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ResetPasswordPage } from "./ResetPasswordPage";
import type { AuthContextValue, AuthStatus } from "../../auth/AuthContext";

// Mismo criterio que LoginPage.test.tsx: useAuth se mockea directo (no
// AuthProvider completo) — ResetPasswordPage solo depende del campo
// `status` del contrato, no de cómo se resuelve. supabase.auth.updateUser
// se mockea aparte, como la otra frontera externa real que este componente
// toca directamente.
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
const updateUser = vi.hoisted(() => vi.fn<() => Promise<{ data: unknown; error: Error | null }>>());

vi.mock("../../auth/AuthContext", () => ({
  useAuth: useAuthMock,
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => updateUser(...(args as [])),
    },
  },
}));

function mockAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "authenticated" as AuthStatus,
    me: null,
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/" element={<div>home-ok</div>} />
        <Route path="/forgot-password" element={<div>forgot-ok</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  updateUser.mockReset();
  updateUser.mockResolvedValue({ data: {}, error: null });
});

describe("ResetPasswordPage — R1.3", () => {
  it("con una sesión de recuperación (status !== unauthenticated), muestra el formulario", () => {
    useAuthMock.mockReturnValue(mockAuth({ status: "authenticated" }));
    renderPage();

    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });

  it("link inválido o vencido (status unauthenticated) no muestra el formulario", () => {
    useAuthMock.mockReturnValue(mockAuth({ status: "unauthenticated" }));
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/no es válido o expiró/i);
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });

  it("contraseñas que no coinciden no llaman a updateUser", async () => {
    useAuthMock.mockReturnValue(mockAuth({ status: "authenticated" }));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "distinta456");
    await user.click(screen.getByRole("button", { name: /guardar contraseña/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("no coinciden");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("submit exitoso llama a updateUser({ password }) y redirige a '/'", async () => {
    useAuthMock.mockReturnValue(mockAuth({ status: "authenticated" }));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /guardar contraseña/i }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "password123" }));
    await waitFor(() => expect(screen.getByText("home-ok")).toBeInTheDocument());
  });

  it("un error de updateUser se muestra y no redirige", async () => {
    useAuthMock.mockReturnValue(mockAuth({ status: "authenticated" }));
    updateUser.mockResolvedValueOnce({ data: null, error: new Error("token vencido") });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /guardar contraseña/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("token vencido"));
    expect(screen.queryByText("home-ok")).not.toBeInTheDocument();
  });
});
