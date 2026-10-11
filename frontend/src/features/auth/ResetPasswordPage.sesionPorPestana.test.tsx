import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server } from "../../test/msw/server";
import { meErrorHandler } from "../../test/msw/handlers";
import { AuthProvider } from "../../auth/AuthContext";
import { ResetPasswordPage } from "./ResetPasswordPage";

// Archivo aparte de ResetPasswordPage.test.tsx a propósito: ese mockea useAuth
// entero (vi.mock por ruta de módulo, para todo el archivo), y lo que se prueba
// acá es justamente AuthProvider real reaccionando a eventos de supabase-js.
// Mismo criterio que AcceptInvitationPage.test.tsx: solo se mockea la frontera
// externa (supabase.auth); AuthProvider, TanStack Query y request() corren de
// verdad contra MSW.
//
// Sesión por pestaña (ver AuthContext, onAuthStateChange): el link de
// recuperación deja la sesión en el sessionStorage de SU pestaña. Bug real:
// con otra pestaña abierta en /forgot-password (sin sesión), esa pestaña
// recibía el PASSWORD_RECOVERY por el BroadcastChannel, pedía /api/me sin
// token, el 401 hacía signOut y el SIGNED_OUT volvía a la pestaña del link,
// que mostraba "Este enlace no es válido o expiró".
interface MockSession {
  user: { id: string; email: string };
  access_token: string;
}

const mock = vi.hoisted(() => {
  let callback: ((event: string, session: MockSession | null) => void) | null = null;
  // El sessionStorage de ESTA pestaña: lo que devuelve getSession().
  let currentSession: MockSession | null = null;

  const onAuthStateChange = vi.fn((cb: (event: string, session: MockSession | null) => void) => {
    callback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  const getSession = vi.fn(async () => ({ data: { session: currentSession } }));
  const signOut = vi.fn(async () => ({ error: null as Error | null }));

  return {
    onAuthStateChange,
    getSession,
    signOut,
    // Evento propio: supabase-js ya guardó la sesión antes de avisar.
    emit: (event: string, session: MockSession | null) => {
      currentSession = session;
      callback?.(event, session);
    },
    // Evento de otra pestaña: trae la sesión de esa pestaña, no toca la propia.
    emitDesdeOtraPestana: (event: string, session: MockSession | null) => {
      callback?.(event, session);
    },
    reset: () => {
      callback = null;
      currentSession = null;
    },
  };
});

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: mock.onAuthStateChange,
      getSession: mock.getSession,
      signOut: mock.signOut,
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

function sesionDeRecuperacion(): MockSession {
  return {
    user: { id: "user-recupera", email: "persona@example.com" },
    access_token: "token-recuperacion",
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/reset-password"]}>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/login" element={<div>login-ok</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mock.reset();
  vi.clearAllMocks();
});

describe("ResetPasswordPage — sesión por pestaña", () => {
  // /api/me no importa para esta pantalla (alcanza con que haya sesión): se
  // responde algo distinto de 401 para que el estado no dependa de él.
  beforeEach(() => {
    server.use(meErrorHandler(500, "sin importancia para esta pantalla"));
  });

  it("con la sesión del link en esta pestaña y otra pestaña emitiendo eventos: muestra el formulario", async () => {
    renderPage();

    await act(async () => mock.emit("PASSWORD_RECOVERY", sesionDeRecuperacion()));
    await waitFor(() => expect(screen.getByLabelText("Contraseña")).toBeInTheDocument());

    // Lo que llegaba desde la pestaña de /forgot-password.
    await act(async () => {
      mock.emitDesdeOtraPestana("PASSWORD_RECOVERY", sesionDeRecuperacion());
      mock.emitDesdeOtraPestana("SIGNED_OUT", null);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByRole("heading", { name: "Elegí una nueva contraseña" })).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.queryByText(/no es válido o expiró/)).not.toBeInTheDocument();
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it("link abierto en un navegador o dispositivo limpio (solo la sesión propia): muestra el formulario", async () => {
    renderPage();

    await act(async () => mock.emit("PASSWORD_RECOVERY", sesionDeRecuperacion()));

    await waitFor(() => expect(screen.getByLabelText("Contraseña")).toBeInTheDocument());
    expect(screen.getByLabelText("Confirmar contraseña")).toBeInTheDocument();
    expect(screen.queryByText(/no es válido o expiró/)).not.toBeInTheDocument();
  });

  it("sin sesión propia, un PASSWORD_RECOVERY de otra pestaña no la vuelve válida", async () => {
    // El otro lado del bug: la pestaña de /forgot-password no tiene que pasar
    // a "con sesión" por el evento ajeno.
    renderPage();
    await act(async () => mock.emit("INITIAL_SESSION", null));
    await waitFor(() => expect(screen.getByText(/no es válido o expiró/)).toBeInTheDocument());

    await act(async () => {
      mock.emitDesdeOtraPestana("PASSWORD_RECOVERY", sesionDeRecuperacion());
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByText(/no es válido o expiró/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
    expect(mock.signOut).not.toHaveBeenCalled();
  });
});
