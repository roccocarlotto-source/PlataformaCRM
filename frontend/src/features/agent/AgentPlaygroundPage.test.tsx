import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAgent } from "../../test/agentFixtures";
import { makeContact } from "../../test/contactFixtures";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AgentPlaygroundPage } from "./AgentPlaygroundPage";
import type { Agent, TestMessageResult } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usan los casos de AdminRoute del final: la pantalla no consume
// useAuth (no tiene gate por rol propio, ver su comentario de cabecera).
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const agentUrl = `${env.apiUrl}/api/agents/ag1`;
const testMessageUrl = `${agentUrl}/test-message`;
const contactsUrl = `${env.apiUrl}/api/contacts`;

const ADVERTENCIA = /Esto no es un entorno de prueba aislado/;

function mockAgent(overrides: Partial<Agent> = {}) {
  return http.get(agentUrl, () => HttpResponse.json(makeAgent(overrides)));
}

// ContactSelect busca server-side con debounce y, una vez elegido, resuelve el
// contacto por id (useContact). Los dos handlers hacen falta siempre que un
// test elija un contacto.
function mockContacts() {
  return [
    http.get(contactsUrl, () =>
      HttpResponse.json({
        data: [makeContact(), makeContact({ id: "ct2", firstName: "Bruno", lastName: "Gómez" })],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      }),
    ),
    http.get(`${contactsUrl}/:id`, ({ params }) =>
      HttpResponse.json(
        params.id === "ct2"
          ? makeContact({ id: "ct2", firstName: "Bruno", lastName: "Gómez" })
          : makeContact(),
      ),
    ),
  ];
}

function makeTurno(overrides: Partial<TestMessageResult> = {}): TestMessageResult {
  return {
    conversationId: "cv1",
    status: "ACTIVE",
    respuesta: "Hola, ¿en qué te puedo ayudar?",
    toolCalls: [],
    handoff: false,
    handoffActivityId: null,
    ...overrides,
  };
}

function mockTurno(overrides: Partial<TestMessageResult> = {}) {
  return http.post(testMessageUrl, () => HttpResponse.json(makeTurno(overrides)));
}

// El 400 del backend tal como lo arma errorHandler.ts: lo que importa es que
// el `message` llegue a la pantalla sin que nadie lo reescriba.
function mockTurnoConError(message: string) {
  return http.post(testMessageUrl, () =>
    HttpResponse.json({ error: { message } }, { status: 400 }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agents/ag1/playground"]}>
        <Routes>
          <Route path="/agents/:id/playground" element={<AgentPlaygroundPage />} />
          <Route path="/agents" element={<div>listado de agentes</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function cajaDeMensaje(): HTMLTextAreaElement {
  return screen.getByLabelText("Mensaje del contacto");
}

// Busca y elige un contacto en ContactSelect: escribir dispara la búsqueda
// (debounce de 300ms, absorbido por el findByRole) y el resultado es un
// <button> con el nombre completo.
async function elegirContacto(user: UserEvent, nombre = "Juana Pérez") {
  const buscador = screen.getByPlaceholderText("Buscar por nombre o email…");
  await user.clear(buscador);
  await user.type(buscador, nombre.slice(0, 3));
  await user.click(await screen.findByRole("button", { name: nombre }));
}

function transcripcion() {
  return within(screen.getByRole("list", { name: "Transcripción" }));
}

async function mandar(user: UserEvent, texto: string) {
  await user.type(cajaDeMensaje(), texto);
  await user.click(screen.getByRole("button", { name: "Enviar" }));
}

describe("AgentPlaygroundPage — la advertencia y el contacto", () => {
  it("la advertencia de que NO es un sandbox está desde que carga la pantalla", async () => {
    server.use(mockAgent());
    renderPage();

    expect(await screen.findByText(ADVERTENCIA)).toBeInTheDocument();
  });

  it("el hint manda a la bandeja para ver el hilo completo (ítem 66)", async () => {
    server.use(mockAgent());
    renderPage();

    await screen.findByText(ADVERTENCIA);
    // Hasta el ítem 66 este hint decía que no había forma de recuperar los
    // mensajes de una sesión anterior. Ahora la hay, y el texto la nombra en
    // vez de afirmar algo que dejó de ser cierto.
    expect(screen.getByRole("link", { name: "Conversaciones" })).toHaveAttribute(
      "href",
      "/conversations",
    );
  });

  it("sin contacto elegido no se puede escribir ni enviar", async () => {
    server.use(mockAgent());
    renderPage();

    await screen.findByText(ADVERTENCIA);
    expect(cajaDeMensaje()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    expect(screen.getByText("Elegí un contacto para empezar.")).toBeInTheDocument();
  });

  it("elegir un contacto habilita la caja", async () => {
    server.use(mockAgent(), ...mockContacts());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);

    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
  });
});

describe("AgentPlaygroundPage — mandar un mensaje", () => {
  it("agrega la burbuja del contacto y la del agente", async () => {
    server.use(mockAgent(), ...mockContacts(), mockTurno());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "hola");

    expect(await transcripcion().findByText("hola")).toBeInTheDocument();
    expect(transcripcion().getByText("Hola, ¿en qué te puedo ayudar?")).toBeInTheDocument();
    // Queda claro que se escribe COMO el contacto, no como quien prueba.
    expect(transcripcion().getByText("Contacto (vos)")).toBeInTheDocument();
    expect(transcripcion().getByText("Asistente de ventas")).toBeInTheDocument();
  });

  it("el POST lleva contactId, message y channel, y la caja queda vacía", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockAgent(),
      ...mockContacts(),
      http.post(testMessageUrl, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeTurno());
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "quiero un presupuesto");

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      contactId: "ct1",
      message: "quiero un presupuesto",
      channel: "WEB",
    });
    expect(cajaDeMensaje()).toHaveValue("");
  });

  // `status: "ACTIVE"` a propósito (ítem 83): la nota sale de que `respuesta`
  // sea null —una persona ya está atendiendo—, no del status. Una conversación
  // derivada que nadie tomó todavía viene con respuesta y burbuja normal.
  it("una respuesta null muestra la nota de que no respondió, no una burbuja vacía", async () => {
    server.use(mockAgent(), ...mockContacts(), mockTurno({ respuesta: null, status: "ACTIVE" }));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "hola?");

    expect(
      await transcripcion().findByText(
        "El agente no respondió — una persona del equipo ya está atendiendo esta conversación.",
      ),
    ).toBeInTheDocument();
  });

  it("handoff: true muestra la nota de derivación y el link a la actividad creada", async () => {
    server.use(
      mockAgent(),
      ...mockContacts(),
      mockTurno({
        respuesta: "Ya te contacta alguien del equipo.",
        handoff: true,
        handoffActivityId: "act-9",
        status: "TRANSFERRED_TO_HUMAN",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "quiero hablar con una persona");

    expect(
      await transcripcion().findByText("Se derivó esta conversación a un humano."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "abrirla" })).toHaveAttribute(
      "href",
      "/activities/act-9/edit",
    );
  });

  it("un handoff sin actividad no inventa ningún link", async () => {
    server.use(
      mockAgent(),
      ...mockContacts(),
      mockTurno({ handoff: true, handoffActivityId: null }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "hola");

    await transcripcion().findByText("Se derivó esta conversación a un humano.");
    expect(screen.queryByRole("link", { name: "abrirla" })).not.toBeInTheDocument();
  });
});

describe("AgentPlaygroundPage — las tool calls en la transcripción", () => {
  it("una tool ejecutada se muestra con su nombre y su resultado", async () => {
    server.use(
      mockAgent(),
      ...mockContacts(),
      mockTurno({
        toolCalls: [
          {
            id: "call-1",
            name: "create_opportunity",
            arguments: { title: "Consulta web" },
            allowed: true,
            result: { ok: true, data: { opportunityId: "op-1" } },
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "quiero comprar");

    const lista = transcripcion();
    expect(await lista.findByText("Crear oportunidad")).toBeInTheDocument();
    expect(lista.getByText("create_opportunity")).toBeInTheDocument();
    expect(lista.getByText('{"title":"Consulta web"}')).toBeInTheDocument();
    expect(lista.getByText('{"opportunityId":"op-1"}')).toBeInTheDocument();
  });

  it("una tool bloqueada dice que se bloqueó y por qué", async () => {
    server.use(
      mockAgent(),
      ...mockContacts(),
      mockTurno({
        toolCalls: [
          {
            id: "call-2",
            name: "update_opportunity",
            arguments: {},
            allowed: false,
            reason: "El agente no puede cambiar el monto",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "bajame el precio");

    expect(
      await transcripcion().findByText(
        "Bloqueada por las reglas del agente: El agente no puede cambiar el monto",
      ),
    ).toBeInTheDocument();
  });
});

describe("AgentPlaygroundPage — cambiar de contacto", () => {
  it("limpia la transcripción: para la pantalla es otra conversación", async () => {
    server.use(mockAgent(), ...mockContacts(), mockTurno());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "hola");
    await transcripcion().findByText("hola");

    await elegirContacto(user, "Bruno Gómez");

    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Transcripción" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Escribí un mensaje para empezar.")).toBeInTheDocument();
  });
});

describe("AgentPlaygroundPage — canales", () => {
  it("con un solo canal habilitado no hay selector, se muestra fijo", async () => {
    server.use(mockAgent({ channels: ["WHATSAPP"] }));
    renderPage();

    await screen.findByText(ADVERTENCIA);
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.queryByLabelText("Canal")).not.toBeInTheDocument();
  });

  it("con dos canales el elegido viaja en el POST", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      mockAgent({ channels: ["WEB", "WHATSAPP"] }),
      ...mockContacts(),
      http.post(testMessageUrl, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeTurno());
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());

    const canal = screen.getByLabelText("Canal");
    await user.click(canal);
    await user.click(await screen.findByRole("option", { name: "WhatsApp" }));
    await mandar(user, "hola");

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ channel: "WHATSAPP" });
  });

  it("sin ningún canal habilitado no hay con qué probar y lo dice", async () => {
    server.use(mockAgent({ channels: [] }));
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Este agente no tiene ningún canal habilitado" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "editar el agente" })).toHaveAttribute(
      "href",
      "/agents/ag1/edit",
    );
    // No hay caja: la pantalla se reemplaza entera, no se muestra deshabilitada.
    expect(screen.queryByLabelText("Mensaje del contacto")).not.toBeInTheDocument();
  });
});

describe("AgentPlaygroundPage — errores", () => {
  it("un agente desactivado avisa y no deja mandar", async () => {
    server.use(mockAgent({ isActive: false }), ...mockContacts());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    expect(
      screen.getByText(/Este agente está desactivado y no responde mensajes/),
    ).toBeInTheDocument();

    await elegirContacto(user);
    // Ni con contacto elegido: el backend respondería 400 y ofrecer un botón
    // que solo puede fallar es peor que no ofrecerlo.
    expect(cajaDeMensaje()).toBeDisabled();
  });

  it("un 400 del backend se muestra tal cual y no pierde los mensajes previos", async () => {
    let turnos = 0;
    server.use(
      mockAgent(),
      ...mockContacts(),
      http.post(testMessageUrl, () => {
        turnos += 1;
        return turnos === 1
          ? HttpResponse.json(makeTurno())
          : HttpResponse.json(
              { error: { message: "El agente está desactivado" } },
              { status: 400 },
            );
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "hola");
    await transcripcion().findByText("Hola, ¿en qué te puedo ayudar?");

    await mandar(user, "seguís ahí?");

    const lista = transcripcion();
    expect(await lista.findByText("El agente está desactivado")).toBeInTheDocument();
    // Lo de antes sigue en pantalla, el mensaje que falló incluido.
    expect(lista.getByText("hola")).toBeInTheDocument();
    expect(lista.getByText("Hola, ¿en qué te puedo ayudar?")).toBeInTheDocument();
    expect(lista.getByText("seguís ahí?")).toBeInTheDocument();
  });

  it("el 400 de canal no habilitado también se muestra con el texto del backend", async () => {
    server.use(
      mockAgent(),
      ...mockContacts(),
      mockTurnoConError("El agente no atiende el canal WEB"),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(ADVERTENCIA);
    await elegirContacto(user);
    await waitFor(() => expect(cajaDeMensaje()).toBeEnabled());
    await mandar(user, "hola");

    expect(
      await transcripcion().findByText("El agente no atiende el canal WEB"),
    ).toBeInTheDocument();
  });

  it("un agente que no carga no muestra el probador", async () => {
    server.use(
      http.get(agentUrl, () => HttpResponse.json({ error: { message: "nop" } }, { status: 500 })),
    );
    renderPage();

    expect(await screen.findByText(/No pudimos cargar el agente/)).toBeInTheDocument();
    expect(screen.queryByText(ADVERTENCIA)).not.toBeInTheDocument();
  });
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// AgentPlaygroundPage), con el destino del redirect reemplazado por un
// placeholder. Acá importa especialmente: POST /agents/:id/test-message es
// ADMIN-only en el backend y ejecuta acciones reales.
function renderUnderAdminRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agents/ag1/playground"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/agents/:id/playground" element={<AgentPlaygroundPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentPlaygroundPage — bajo AdminRoute", () => {
  it("un USER es redirigido y NO se pide el agente", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let pedidos = 0;
    server.use(
      http.get(agentUrl, () => {
        pedidos += 1;
        return HttpResponse.json(makeAgent());
      }),
    );

    renderUnderAdminRoute();

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(pedidos).toBe(0);
  });

  it("un ADMIN sí ve la pantalla", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(mockAgent());

    renderUnderAdminRoute();

    expect(await screen.findByRole("heading", { name: "Probar el agente" })).toBeInTheDocument();
  });
});
