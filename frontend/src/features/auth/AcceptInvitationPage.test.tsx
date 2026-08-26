import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { AuthProvider } from "../../auth/AuthContext";
import { AcceptInvitationPage } from "./AcceptInvitationPage";

// Mismo criterio que auth/AuthContext.test.tsx: se mockea únicamente la
// frontera externa real (supabase.auth) — AuthProvider, TanStack Query y el
// QueryClient real corren sin mockear, contra MSW interceptando /api/me y
// /api/invitations/accept. Esto ejercita el flujo completo con la máquina
// de estados real de AuthContext, no una simulación aparte.
interface MockUser {
  id: string;
  email: string;
  user_metadata?: { invitationId?: string };
}
interface MockSession {
  user: MockUser;
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
  const getUser = vi.fn(async () => ({
    data: { user: currentSession?.user ?? null },
    error: null,
  }));
  const updateUser = vi.fn(async (): Promise<{ data: unknown; error: Error | null }> => ({
    data: {},
    error: null,
  }));

  return {
    onAuthStateChange,
    getSession,
    getUser,
    updateUser,
    emit: (event: string, session: MockSession | null) => {
      currentSession = session;
      callback?.(event, session);
    },
    reset: () => {
      callback = null;
      currentSession = null;
      updateUser.mockReset();
      updateUser.mockResolvedValue({ data: {}, error: null });
    },
  };
});

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: mock.onAuthStateChange,
      getSession: mock.getSession,
      getUser: mock.getUser,
      updateUser: mock.updateUser,
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const meUrl = `${env.apiUrl}/api/me`;
const acceptUrl = `${env.apiUrl}/api/invitations/accept`;

function invitedSession(overrides: Partial<MockUser> = {}): MockSession {
  return {
    user: { id: "invited-1", email: "invitado@example.com", ...overrides },
    access_token: "invite-session-token",
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/invite/accept"]}>
          <Routes>
            <Route path="/invite/accept" element={<AcceptInvitationPage />} />
            <Route path="/" element={<div>home-after-accept</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

// El backend real: antes de aceptar, GET /api/me da 403 ("account-unavailable");
// después de un accept exitoso, la misma fila ya existe y da 200. Se simula
// ese comportamiento real con un flag mutable, no con un mock ciego.
let profileExists = false;

function meHandler(status: 200 | 500 = 200) {
  return http.get(meUrl, () => {
    if (profileExists) {
      if (status === 500) {
        return HttpResponse.json({ error: { message: "boom" } }, { status: 500 });
      }
      return HttpResponse.json({
        id: "invited-1",
        email: "invitado@example.com",
        fullName: "Nueva Persona",
        organizationId: "org-1",
        role: "USER",
      });
    }
    return HttpResponse.json(
      { error: { message: "Tu cuenta todavía no está activada. Contactá a tu administrador." } },
      { status: 403 },
    );
  });
}

function acceptSuccessHandler(onCalled?: () => void) {
  return http.post(acceptUrl, async () => {
    profileExists = true;
    onCalled?.();
    return HttpResponse.json(
      {
        id: "invited-1",
        organizationId: "org-1",
        roleId: "role-user",
        email: "invitado@example.com",
        fullName: "Nueva Persona",
      },
      { status: 201 },
    );
  });
}

beforeEach(() => {
  profileExists = false;
  sessionStorage.clear();
  mock.reset();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("AcceptInvitationPage", () => {
  it("loading: sin sesión resuelta todavía muestra Cargando…", () => {
    server.use(meHandler());
    renderPage();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("unauthenticated: enlace inválido/vencido", async () => {
    server.use(meHandler());
    renderPage();

    await act(async () => {
      mock.emit("SIGNED_OUT", null);
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "Este enlace no es válido o expiró. Pedile a tu administrador que te reinvite.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("authenticated existente (sesión ajena, sin marca de aceptación pendiente): mensaje de ya-logueado", async () => {
    profileExists = true; // esta identidad YA tiene public.users, sin relación con este flujo
    server.use(meHandler());
    renderPage();

    await act(async () => {
      mock.emit("SIGNED_IN", invitedSession());
    });

    await waitFor(() =>
      expect(screen.getByText(/Ya iniciaste sesión como invitado@example.com/)).toBeInTheDocument(),
    );
  });

  // Remediación mínima post-informe: la sesión de Supabase persiste en
  // localStorage (persistSession, sin storage custom) incluso si se cierra
  // la pestaña/el navegador — a diferencia del marcador de sessionStorage,
  // que sí se pierde. Sin esta opción, alguien que cerró el navegador
  // antes de terminar de configurar su contraseña quedaba con un mensaje
  // puramente informativo, sin ninguna acción real disponible para
  // completar el paso pendiente.
  it("authenticated existente sin marca: además del mensaje, ofrece configurar contraseña — y funciona sin repetir accept", async () => {
    profileExists = true;
    let acceptCalls = 0;
    server.use(
      meHandler(),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();

    await act(async () => {
      mock.emit("SIGNED_IN", invitedSession());
    });

    await waitFor(() =>
      expect(screen.getByText(/Ya iniciaste sesión como invitado@example.com/)).toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /configurar contraseña/i }));

    await waitFor(() => expect(screen.getByText("home-after-accept")).toBeInTheDocument());
    expect(mock.updateUser).toHaveBeenCalledWith({ password: "password123" });
    expect(acceptCalls).toBe(0);
  });

  it("account-unavailable esperado: muestra el formulario real", async () => {
    server.use(meHandler());
    renderPage();

    await act(async () => {
      mock.emit("SIGNED_IN", invitedSession());
    });

    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirmar contraseña")).toBeInTheDocument();
  });

  it("fullName requerido: submit sin nombre no dispara accept", async () => {
    let acceptCalls = 0;
    server.use(
      meHandler(),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    expect(acceptCalls).toBe(0);
  });

  it("password: menor al mínimo real (8) bloquea el submit con mensaje explícito", async () => {
    let acceptCalls = 0;
    server.use(
      meHandler(),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "short1");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "short1");
    // minLength HTML5 bloquea el submit en jsdom; se fuerza igual el submit
    // para probar también la validación explícita del handler.
    const form = screen.getByRole("button", { name: /completar registro/i }).closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(acceptCalls).toBe(0);
  });

  it("confirmación: passwords que no coinciden bloquean el submit", async () => {
    let acceptCalls = 0;
    server.use(
      meHandler(),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password456");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(screen.getByText("Las contraseñas no coinciden")).toBeInTheDocument(),
    );
    expect(acceptCalls).toBe(0);
  });

  it("invitationId desde user_metadata viaja en el body de accept", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      meHandler(),
      http.post(acceptUrl, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        profileExists = true;
        return HttpResponse.json({ id: "invited-1" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () =>
      mock.emit("SIGNED_IN", invitedSession({ user_metadata: { invitationId: "meta-inv-1" } })),
    );
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() => expect(capturedBody).toBeDefined());
    expect(capturedBody?.invitationId).toBe("meta-inv-1");
    expect(capturedBody?.fullName).toBe("Nueva Persona");
  });

  it("accept sin invitationId en metadata: el body lo omite", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      meHandler(),
      http.post(acceptUrl, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        profileExists = true;
        return HttpResponse.json({ id: "invited-1" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() => expect(capturedBody).toBeDefined());
    expect(capturedBody).not.toHaveProperty("invitationId");
  });

  it("accept se ejecuta ANTES que updateUser({password}) — orden verificado", async () => {
    const callOrder: string[] = [];
    mock.updateUser.mockImplementation(async () => {
      callOrder.push("updateUser");
      return { data: {}, error: null };
    });
    server.use(
      meHandler(),
      http.post(acceptUrl, async () => {
        callOrder.push("accept");
        profileExists = true;
        return HttpResponse.json({ id: "invited-1" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() => expect(callOrder).toEqual(["accept", "updateUser"]));
  });

  it("accept falla: updateUser NO se ejecuta, se muestra el error real y permite reintentar", async () => {
    server.use(
      meHandler(),
      http.post(acceptUrl, () =>
        HttpResponse.json(
          {
            error: { message: "Esta invitación venció, pedile a tu administrador que te reinvite" },
          },
          { status: 410 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Esta invitación venció, pedile a tu administrador que te reinvite"),
      ).toBeInTheDocument(),
    );
    expect(mock.updateUser).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("accept exitoso: updateUser se ejecuta con la contraseña ingresada", async () => {
    server.use(meHandler(), acceptSuccessHandler());
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() => expect(mock.updateUser).toHaveBeenCalledWith({ password: "password123" }));
  });

  it("password update falla tras accept exitoso: NO repite accept, muestra error específico con retry", async () => {
    let acceptCalls = 0;
    mock.updateUser.mockResolvedValueOnce({
      data: null,
      error: new Error("Password muy débil para Supabase"),
    });
    server.use(
      meHandler(),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(screen.getByText("Password muy débil para Supabase")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Tu cuenta ya fue creada. Solo falta configurar tu contraseña."),
    ).toBeInTheDocument();
    expect(acceptCalls).toBe(1);
  });

  it("retry de password tras fallo ejecuta SOLO updateUser, no repite accept", async () => {
    let acceptCalls = 0;
    mock.updateUser.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    server.use(
      meHandler(),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() => expect(mock.updateUser).toHaveBeenCalledTimes(2));
    expect(acceptCalls).toBe(1);
  });

  it("password exitoso dispara retryProfile (nueva consulta a /api/me) y redirige cuando resuelve", async () => {
    server.use(meHandler(), acceptSuccessHandler());
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() => expect(screen.getByText("home-after-accept")).toBeInTheDocument());
  });

  it("retryProfile falla (500) tras accept+password exitosos: NO repite accept ni password, permite reintentar solo el perfil", async () => {
    let acceptCalls = 0;
    server.use(
      meHandler(500),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(screen.getByText(/No pudimos confirmar tu perfil/)).toBeInTheDocument(),
    );
    expect(acceptCalls).toBe(1);
    expect(mock.updateUser).toHaveBeenCalledTimes(1);
  });

  it("retry de perfil ejecuta solo retryProfile, sin repetir accept ni password, y redirige si ahora resuelve", async () => {
    let acceptCalls = 0;
    let meCallCount = 0;
    server.use(
      http.get(meUrl, () => {
        meCallCount++;
        if (!profileExists) {
          return HttpResponse.json({ error: { message: "no activada" } }, { status: 403 });
        }
        // Primera vez que profileExists es true: falla (simula el error
        // transitorio de retryProfile); las siguientes, resuelve bien.
        if (meCallCount <= 2) {
          return HttpResponse.json({ error: { message: "boom" } }, { status: 500 });
        }
        return HttpResponse.json({
          id: "invited-1",
          email: "invitado@example.com",
          fullName: "Nueva Persona",
          organizationId: "org-1",
          role: "USER",
        });
      }),
      acceptSuccessHandler(() => acceptCalls++),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Nombre completo"), "Nueva Persona");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(screen.getByText(/No pudimos confirmar tu perfil/)).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() => expect(screen.getByText("home-after-accept")).toBeInTheDocument());
    expect(acceptCalls).toBe(1);
    expect(mock.updateUser).toHaveBeenCalledTimes(1);
  });

  it("404: invitación no encontrada se muestra tal cual", async () => {
    server.use(
      meHandler(),
      http.post(acceptUrl, () =>
        HttpResponse.json(
          { error: { message: "No se encontró ninguna invitación para tu email" } },
          { status: 404 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Nombre completo"), "X");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(
        screen.getByText("No se encontró ninguna invitación para tu email"),
      ).toBeInTheDocument(),
    );
  });

  it("409: ya aceptada se muestra tal cual", async () => {
    server.use(
      meHandler(),
      http.post(acceptUrl, () =>
        HttpResponse.json(
          { error: { message: "Esta invitación ya fue aceptada" } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Nombre completo"), "X");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(screen.getByText("Esta invitación ya fue aceptada")).toBeInTheDocument(),
    );
  });

  it("410: revocada/vencida se muestra tal cual", async () => {
    server.use(
      meHandler(),
      http.post(acceptUrl, () =>
        HttpResponse.json(
          {
            error: {
              message: "Esta invitación fue revocada, pedile a tu administrador que te reinvite",
            },
          },
          { status: 410 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Nombre completo"), "X");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Esta invitación fue revocada, pedile a tu administrador que te reinvite"),
      ).toBeInTheDocument(),
    );
  });

  it("429: demasiados intentos se muestra tal cual", async () => {
    server.use(
      meHandler(),
      http.post(acceptUrl, () =>
        HttpResponse.json(
          { error: { message: "Demasiados intentos. Probá de nuevo más tarde." } },
          { status: 429 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));
    await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Nombre completo"), "X");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: /completar registro/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Demasiados intentos. Probá de nuevo más tarde."),
      ).toBeInTheDocument(),
    );
  });

  it("recarga tras accept exitoso (marca sessionStorage): pide contraseña directamente, sin repetir accept", async () => {
    let acceptCalls = 0;
    // Simula que un ciclo previo (antes del F5) ya llamó a accept con éxito.
    profileExists = true;
    sessionStorage.setItem("m7-invite-accept-pending-password", "invitado@example.com");
    server.use(
      meHandler(),
      acceptSuccessHandler(() => acceptCalls++),
    );

    renderPage();
    await act(async () => mock.emit("SIGNED_IN", invitedSession()));

    await waitFor(() => expect(screen.getByText("Configurá tu contraseña")).toBeInTheDocument());
    expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
    expect(acceptCalls).toBe(0);
  });
});
