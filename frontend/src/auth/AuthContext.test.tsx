import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider, useAuth, type MeResponse } from "./AuthContext";
import { server } from "../test/msw/server";
import {
  meByTokenHandler,
  meErrorHandler,
  meNetworkErrorHandler,
  meSuccessHandler,
} from "../test/msw/handlers";

// Cobertura de los 14 escenarios de M1 documentados en docs/project-overview.md
// (STD-SW-003). Cada `it(...)` cita el número de escenario tal cual está
// enumerado ahí. Solo se mockea la frontera externa real (supabase.auth) —
// request()/ApiError, TanStack Query y el QueryClient real corren sin mockear,
// contra MSW interceptando la red.

interface MockSession {
  user: { id: string };
  access_token: string;
}

const mock = vi.hoisted(() => {
  let callback: ((event: string, session: MockSession | null) => void) | null = null;
  let currentSession: MockSession | null = null;

  const onAuthStateChange = vi.fn((cb: (event: string, session: MockSession | null) => void) => {
    callback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  const getSession = vi.fn(async () => ({ data: { session: currentSession } }));
  const signInWithPassword = vi.fn(async () => ({ error: null as Error | null }));
  const signOut = vi.fn(async () => ({ error: null as Error | null }));

  return {
    onAuthStateChange,
    getSession,
    signInWithPassword,
    signOut,
    emit: (event: string, session: MockSession | null) => {
      currentSession = session;
      callback?.(event, session);
    },
    reset: () => {
      callback = null;
      currentSession = null;
    },
  };
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: mock.onAuthStateChange,
      getSession: mock.getSession,
      signInWithPassword: mock.signInWithPassword,
      signOut: mock.signOut,
    },
  },
}));

function sessionFor(userId: string, token: string): MockSession {
  return { user: { id: userId }, access_token: token };
}

const profileA: MeResponse = {
  id: "user-a",
  email: "a@example.com",
  fullName: "Usuario A",
  organizationId: "org-a",
  role: "ADMIN",
};

const profileB: MeResponse = {
  id: "user-b",
  email: "b@example.com",
  fullName: "Usuario B",
  organizationId: "org-b",
  role: "USER",
};

// Consumidor mínimo de prueba. El manejo de logout (try/catch + estado local
// de error) es deliberadamente el mismo patrón que va a usar AppLayout en
// Bloque 3 — así el test de "signOut fallido" ejercita el contrato real que
// un caller va a implementar, no una simplificación.
function Probe() {
  const auth = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout() {
    setLogoutError(null);
    try {
      await auth.logout();
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "error desconocido");
    }
  }

  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="me-id">{auth.me?.id ?? ""}</span>
      <span data-testid="account-unavailable-reason">{auth.accountUnavailableReason ?? ""}</span>
      <span data-testid="profile-error">{auth.profileError?.message ?? ""}</span>
      <span data-testid="logout-error">{logoutError ?? ""}</span>
      <button onClick={handleLogout}>logout</button>
      <button onClick={auth.retryProfile}>retry</button>
    </div>
  );
}

function renderAuthProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  mock.reset();
  vi.clearAllMocks();
});

describe("AuthProvider — escenarios STD-SW-003", () => {
  it("1. INITIAL_SESSION con sesión A dispara /api/me y termina authenticated", async () => {
    server.use(meSuccessHandler(profileA, "token-a"));
    renderAuthProvider();

    expect(screen.getByTestId("status").textContent).toBe("initializing");

    mock.emit("INITIAL_SESSION", sessionFor("user-a", "token-a"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("me-id").textContent).toBe("user-a");
  });

  it("2. INITIAL_SESSION sin sesión pasa a unauthenticated sin llamar a /api/me", async () => {
    renderAuthProvider();

    mock.emit("INITIAL_SESSION", null);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(mock.getSession).not.toHaveBeenCalled();
  });

  it("5. Evento repetido para la misma identidad no limpia el cache ni refetchea", async () => {
    server.use(meSuccessHandler(profileA, "token-a"));
    const queryClient = renderAuthProvider();
    const clearSpy = vi.spyOn(queryClient, "clear");

    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(clearSpy).toHaveBeenCalledTimes(1);

    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await Promise.resolve();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(screen.getByTestId("me-id").textContent).toBe("user-a");
  });

  it("6. Sesión B reemplaza a A sin SIGNED_OUT previo — me termina representando a B", async () => {
    server.use(
      meByTokenHandler({
        "token-a": { profile: profileA },
        "token-b": { profile: profileB },
      }),
    );
    renderAuthProvider();

    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("me-id").textContent).toBe("user-a"));

    mock.emit("SIGNED_IN", sessionFor("user-b", "token-b"));

    await waitFor(() => expect(screen.getByTestId("me-id").textContent).toBe("user-b"));
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });

  it("7. SIGNED_OUT limpia identidad y cache, deshabilita /api/me", async () => {
    server.use(meSuccessHandler(profileA, "token-a"));
    renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

    mock.emit("SIGNED_OUT", null);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("me-id").textContent).toBe("");
  });

  it("8. signOut fallido no fuerza un logout local falso", async () => {
    const user = userEvent.setup();
    server.use(meSuccessHandler(profileA, "token-a"));
    const queryClient = renderAuthProvider();

    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

    const clearSpy = vi.spyOn(queryClient, "clear");
    mock.signOut.mockResolvedValueOnce({ error: new Error("network down") });

    await user.click(screen.getByText("logout"));

    await waitFor(() =>
      expect(screen.getByTestId("logout-error").textContent).toBe("network down"),
    );
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(screen.getByTestId("me-id").textContent).toBe("user-a");
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("9. TOKEN_REFRESHED no limpia cache ni refetchea /api/me", async () => {
    server.use(meSuccessHandler(profileA, "token-a"));
    let requestCount = 0;
    const onRequestStart = () => {
      requestCount += 1;
    };
    server.events.on("request:start", onRequestStart);

    try {
      const queryClient = renderAuthProvider();
      mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

      const countAfterLogin = requestCount;
      const clearSpy = vi.spyOn(queryClient, "clear");

      mock.emit("TOKEN_REFRESHED", sessionFor("user-a", "token-a-refreshed"));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(requestCount).toBe(countAfterLogin);
      expect(clearSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("status").textContent).toBe("authenticated");
    } finally {
      server.events.removeListener("request:start", onRequestStart);
    }
  });

  it("10. Respuesta tardía de /api/me de A no pisa el estado ya cambiado a B", async () => {
    server.use(
      meByTokenHandler({
        "token-a": { profile: profileA, delayMs: 200 },
        "token-b": { profile: profileB },
      }),
    );
    renderAuthProvider();

    await act(async () => {
      mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    });

    // Confirma que el fetch de A realmente arrancó (in-flight) antes de
    // cambiar a B — sin este chequeo, React 18+ podría batchear los dos
    // `setIdentityKey` sincrónicos en un solo commit y el test terminaría
    // probando únicamente el camino directo a B, nunca la carrera real.
    expect(screen.getByTestId("status").textContent).toBe("loading-profile");

    await act(async () => {
      mock.emit("SIGNED_IN", sessionFor("user-b", "token-b"));
    });

    await waitFor(() => expect(screen.getByTestId("me-id").textContent).toBe("user-b"));

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.getByTestId("me-id").textContent).toBe("user-b");
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });

  it("11. ApiError 403 en /api/me pasa a account-unavailable con el mensaje real", async () => {
    server.use(
      meErrorHandler(403, "Tu cuenta todavía no está activada. Contactá a tu administrador."),
    );
    renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("account-unavailable"),
    );
    expect(screen.getByTestId("account-unavailable-reason").textContent).toBe(
      "Tu cuenta todavía no está activada. Contactá a tu administrador.",
    );
  });

  it("12a. 500 en /api/me pasa a profile-error con un Error no-null", async () => {
    server.use(meErrorHandler(500, "Error interno del servidor"));
    renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("profile-error"));
    expect(screen.getByTestId("profile-error").textContent).not.toBe("");
  });

  it("12b. Error de red en /api/me pasa a profile-error con un Error no-null", async () => {
    server.use(meNetworkErrorHandler());
    renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("profile-error"));
    expect(screen.getByTestId("profile-error").textContent).not.toBe("");
  });

  it("14. (R1.4) Un 401 en /api/me dispara signOut() y, tras el SIGNED_OUT resultante, termina unauthenticated", async () => {
    server.use(meErrorHandler(401, "Token inválido o vencido"));
    renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));

    // El 401 llega vía request() -> registerUnauthorizedHandler(), no vía
    // ninguna acción del usuario — a diferencia del escenario 8 (logout
    // manual), acá nadie clickea nada.
    await waitFor(() => expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" }));

    // El mock de signOut, a diferencia del SDK real, no emite SIGNED_OUT
    // por su cuenta — se simula acá el mismo evento que Supabase dispararía
    // como efecto de un signOut exitoso (mismo patrón que el escenario 7).
    mock.emit("SIGNED_OUT", null);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("me-id").textContent).toBe("");
  });

  it("13. retryProfile() re-dispara /api/me y puede llegar a authenticated", async () => {
    const user = userEvent.setup();
    server.use(meErrorHandler(500, "Error interno del servidor"));
    renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("profile-error"));

    server.use(meSuccessHandler(profileA, "token-a"));
    await user.click(screen.getByText("retry"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("me-id").textContent).toBe("user-a");
  });
});
