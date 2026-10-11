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
  user: { id: string; user_metadata?: Record<string, unknown> };
  access_token: string;
}

// currentSession es el sessionStorage de ESTA pestaña: lo que devuelve
// getSession(). emit() es un evento propio (supabase-js ya guardó o borró la
// sesión antes de avisar); emitDesdeOtraPestana() es el que llega por el
// BroadcastChannel desde otra pestaña, con la sesión de ESA pestaña, sin tocar
// el storage de esta (ver AuthContext, onAuthStateChange).
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
    emitDesdeOtraPestana: (event: string, session: MockSession | null) => {
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
  isPlatformAdmin: false,
  canUseInternalAgent: false,
};

const profileB: MeResponse = {
  id: "user-b",
  email: "b@example.com",
  fullName: "Usuario B",
  organizationId: "org-b",
  role: "USER",
  isPlatformAdmin: false,
  canUseInternalAgent: false,
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
      <span data-testid="debe-aceptar">{String(auth.debeAceptarInvitacion ?? false)}</span>
      <span data-testid="profile-error">{auth.profileError?.message ?? ""}</span>
      <span data-testid="logout-error">{logoutError ?? ""}</span>
      <button onClick={handleLogout}>logout</button>
      <button
        onClick={() => void auth.login("a@example.com", "password123").catch(() => undefined)}
      >
        login
      </button>
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

// AuthContext relee la sesión de la pestaña en un setTimeout(…, 0) después de
// cada evento: esto deja correr esa relectura dentro de act().
async function aplicarEventos(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
    // Antes se verificaba con "getSession no se llamó" (lo llamaba solo
    // getAccessToken, antes de pedir /api/me). Ahora AuthContext también lo
    // llama para leer la sesión de la pestaña, así que se cuentan los requests.
    let requestCount = 0;
    const onRequestStart = () => {
      requestCount += 1;
    };
    server.events.on("request:start", onRequestStart);
    try {
      renderAuthProvider();

      mock.emit("INITIAL_SESSION", null);

      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requestCount).toBe(0);
    } finally {
      server.events.removeListener("request:start", onRequestStart);
    }
  });

  it("5. Evento repetido para la misma identidad no limpia el cache ni refetchea", async () => {
    server.use(meSuccessHandler(profileA, "token-a"));
    const queryClient = renderAuthProvider();
    const clearSpy = vi.spyOn(queryClient, "clear");

    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(clearSpy).toHaveBeenCalledTimes(1);

    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await aplicarEventos();

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
    await aplicarEventos();

    // Confirma que el fetch de A realmente arrancó (in-flight) antes de
    // cambiar a B — sin este chequeo, React 18+ podría batchear los dos
    // `setIdentityKey` sincrónicos en un solo commit y el test terminaría
    // probando únicamente el camino directo a B, nunca la carrera real.
    expect(screen.getByTestId("status").textContent).toBe("loading-profile");

    await act(async () => {
      mock.emit("SIGNED_IN", sessionFor("user-b", "token-b"));
    });
    await aplicarEventos();

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

  // Prueba de la Clínica Demo (2026-10-11): el link de una invitación deja
  // una sesión sin usuario. Solo el 403 CUENTA_NO_ACTIVADA de una sesión que
  // viene de una invitación lleva a aceptarla; una cuenta desactivada no.
  const NO_ACTIVADA = "Tu cuenta todavía no está activada. Contactá a tu administrador.";
  const sesionInvitada = (): MockSession => ({
    user: { id: "user-inv", user_metadata: { invitationId: "inv-1" } },
    access_token: "token-inv",
  });

  it("11b. 403 CUENTA_NO_ACTIVADA con invitationId en la sesión: debe aceptar la invitación", async () => {
    server.use(meErrorHandler(403, NO_ACTIVADA, "CUENTA_NO_ACTIVADA"));
    renderAuthProvider();
    mock.emit("SIGNED_IN", sesionInvitada());

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("account-unavailable"),
    );
    expect(screen.getByTestId("debe-aceptar").textContent).toBe("true");
  });

  it("11c. 403 de cuenta desactivada, aunque la sesión venga de una invitación: no", async () => {
    server.use(meErrorHandler(403, "Tu cuenta fue desactivada."));
    renderAuthProvider();
    mock.emit("SIGNED_IN", sesionInvitada());

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("account-unavailable"),
    );
    expect(screen.getByTestId("debe-aceptar").textContent).toBe("false");
  });

  it("11d. 403 CUENTA_NO_ACTIVADA sin invitationId en la sesión: no", async () => {
    server.use(meErrorHandler(403, NO_ACTIVADA, "CUENTA_NO_ACTIVADA"));
    renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("account-unavailable"),
    );
    expect(screen.getByTestId("debe-aceptar").textContent).toBe("false");
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

// Sesión por pestaña: la sesión vive en el sessionStorage de cada pestaña, pero
// supabase-js reenvía los eventos de una pestaña a las demás por un
// BroadcastChannel. Bug real: una pestaña sin sesión (en /forgot-password)
// recibía el PASSWORD_RECOVERY de la pestaña del link, pedía /api/me sin token,
// el 401 cerraba "la sesión" y ese SIGNED_OUT volteaba a la pestaña del link.
describe("AuthProvider — sesión por pestaña", () => {
  it("un evento de otra pestaña, sin sesión propia: sigue unauthenticated, sin /api/me ni signOut", async () => {
    server.use(meErrorHandler(401, "Falta el token"));
    let requestCount = 0;
    const onRequestStart = () => {
      requestCount += 1;
    };
    server.events.on("request:start", onRequestStart);
    try {
      renderAuthProvider();
      mock.emit("INITIAL_SESSION", null);
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

      mock.emitDesdeOtraPestana("PASSWORD_RECOVERY", sessionFor("user-a", "token-a"));
      mock.emitDesdeOtraPestana("SIGNED_IN", sessionFor("user-a", "token-a"));
      await aplicarEventos();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
      expect(requestCount).toBe(0);
      expect(mock.signOut).not.toHaveBeenCalled();
    } finally {
      server.events.removeListener("request:start", onRequestStart);
    }
  });

  it("un SIGNED_OUT de otra pestaña no cierra la sesión que esta pestaña tiene guardada", async () => {
    server.use(meSuccessHandler(profileA, "token-a"));
    const queryClient = renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    const clearSpy = vi.spyOn(queryClient, "clear");

    mock.emitDesdeOtraPestana("SIGNED_OUT", null);
    await aplicarEventos();

    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(screen.getByTestId("me-id").textContent).toBe("user-a");
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("un login en otra pestaña con otro usuario no cambia la identidad de esta", async () => {
    server.use(
      meByTokenHandler({
        "token-a": { profile: profileA },
        "token-b": { profile: profileB },
      }),
    );
    const queryClient = renderAuthProvider();
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() => expect(screen.getByTestId("me-id").textContent).toBe("user-a"));
    const clearSpy = vi.spyOn(queryClient, "clear");

    mock.emitDesdeOtraPestana("SIGNED_IN", sessionFor("user-b", "token-b"));
    await aplicarEventos();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Ni siquiera hay cambio de identidad: el cache de A queda intacto.
    expect(clearSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("me-id").textContent).toBe("user-a");
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });

  it("la invitación sale de la sesión de esta pestaña, no de la del evento", async () => {
    server.use(
      meErrorHandler(
        403,
        "Tu cuenta todavía no está activada. Contactá a tu administrador.",
        "CUENTA_NO_ACTIVADA",
      ),
    );
    renderAuthProvider();
    // Esta pestaña: sesión sin invitationId. Otra pestaña: una sesión invitada.
    mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("account-unavailable"),
    );

    mock.emitDesdeOtraPestana("SIGNED_IN", {
      user: { id: "user-a", user_metadata: { invitationId: "inv-otra" } },
      access_token: "token-otra",
    });
    await aplicarEventos();

    expect(screen.getByTestId("debe-aceptar").textContent).toBe("false");
  });
});

// Un usuario de una automotora, en una sola pestaña: el login y el logout de
// siempre, con el SDK guardando la sesión antes de avisar (como el real).
describe("automotora sin cambios", () => {
  const perfilAutomotora: MeResponse = {
    ...profileA,
    industry: "AUTOMOTORA",
    edition: "COMPLETA",
  };

  it("automotora sin cambios: login → authenticated con el perfil de /me; logout → unauthenticated", async () => {
    const user = userEvent.setup();
    server.use(meSuccessHandler(perfilAutomotora, "token-a"));
    mock.signInWithPassword.mockImplementationOnce(async () => {
      mock.emit("SIGNED_IN", sessionFor("user-a", "token-a"));
      return { error: null };
    });
    mock.signOut.mockImplementationOnce(async () => {
      mock.emit("SIGNED_OUT", null);
      return { error: null };
    });

    renderAuthProvider();
    mock.emit("INITIAL_SESSION", null);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    await user.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("me-id").textContent).toBe("user-a");
    expect(mock.signInWithPassword).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "password123",
    });

    await user.click(screen.getByText("logout"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("me-id").textContent).toBe("");
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
