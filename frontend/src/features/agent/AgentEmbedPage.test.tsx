import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAgent, makeEmbedToken } from "../../test/agentFixtures";
import { AdminRoute } from "../../auth/AdminRoute";
import { ProtectedRoute } from "../../auth/ProtectedRoute";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AgentEmbedPage } from "./AgentEmbedPage";
import type { EmbedToken } from "./embedToken.types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Solo lo usan los casos de AdminRoute del final: la página no consume useAuth
// (no tiene gate por rol propio, ver su comentario de cabecera).
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
const tokensUrl = `${agentUrl}/embed-tokens`;

// El token en claro del 201 de creación: el ÚNICO lugar del sistema donde
// existe. La fixture del listado (makeEmbedToken) no lo tiene ni puede
// tenerlo, que es justamente lo que estos tests verifican.
const TOKEN_EN_CLARO = "embed_9f3c1a2b4d5e6f708192a3b4c5d6e7f8";

function mockAgent(allowedOrigins: string[] = []) {
  return http.get(agentUrl, () => HttpResponse.json(makeAgent({ allowedOrigins })));
}

function mockTokens(tokens: EmbedToken[] = []) {
  return http.get(tokensUrl, () => HttpResponse.json({ data: tokens }));
}

// Se renderiza dentro de un Routes real para que useParams vea el :id — es de
// donde sale el agente entero de la pantalla.
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agents/ag1/embed"]}>
        <Routes>
          <Route path="/agents/:id/embed" element={<AgentEmbedPage />} />
          <Route path="/agents" element={<div>listado de agentes</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// El código para pegar es un <pre> —no se edita— y es el único de la
// pantalla. Se lee por su contenido, que es exactamente lo que se copia.
function codigoParaPegar(): string {
  const pre = document.querySelector("pre");
  expect(pre).not.toBeNull();
  return pre?.textContent ?? "";
}

// EL ORDEN IMPORTA: userEvent.setup() instala su propio stub de
// navigator.clipboard, así que el doble se pone DESPUÉS de setup() o lo pisa
// (misma trampa documentada en ApiKeySecretDialog.test.tsx).
function mockClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("AgentEmbedPage — dominios permitidos", () => {
  it("la lista vacía dice que el widget está apagado, no que falte cargar algo", async () => {
    server.use(mockAgent([]), mockTokens());
    renderPage();

    expect(
      await screen.findByText(
        "El widget no va a funcionar en ningún sitio hasta que agregues al menos un dominio.",
      ),
    ).toBeInTheDocument();
  });

  it("agregar un dominio y guardar manda la lista ENTERA, no un diff", async () => {
    const patches: Record<string, unknown>[] = [];
    server.use(
      mockAgent(["https://ejemplo.com"]),
      mockTokens(),
      http.patch(agentUrl, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent({ allowedOrigins: ["https://ejemplo.com"] }));
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("https://ejemplo.com");
    await user.type(screen.getByLabelText("Dominio nuevo"), "https://otro.com");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    await user.click(screen.getByRole("button", { name: "Guardar dominios" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    // El PATCH lleva SOLO allowedOrigins: esta pantalla no puede pisar nada de
    // lo que configura el formulario del agente.
    expect(patches[0]).toEqual({
      allowedOrigins: ["https://ejemplo.com", "https://otro.com"],
    });
    expect(await screen.findByText("Dominios guardados.")).toBeInTheDocument();
  });

  it("quitar un dominio también manda la lista completa, sin el que se quitó", async () => {
    const patches: Record<string, unknown>[] = [];
    server.use(
      mockAgent(["https://uno.com", "https://dos.com"]),
      mockTokens(),
      http.patch(agentUrl, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent({ allowedOrigins: ["https://dos.com"] }));
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Quitar https://uno.com" }));
    expect(screen.queryByText("https://uno.com")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar dominios" }));
    await waitFor(() => expect(patches).toEqual([{ allowedOrigins: ["https://dos.com"] }]));
  });

  it("el dominio se normaliza al agregarlo: lo que se ve es lo que se guarda", async () => {
    const patches: Record<string, unknown>[] = [];
    server.use(
      mockAgent([]),
      mockTokens(),
      http.patch(agentUrl, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent({ allowedOrigins: ["https://ejemplo.com"] }));
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Dominio nuevo"), "HTTPS://Ejemplo.com/");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    // El backend normalizaría igual; hacerlo acá evita que la lista muestre
    // una cosa y se guarde otra.
    expect(screen.getByText("https://ejemplo.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar dominios" }));
    await waitFor(() => expect(patches).toEqual([{ allowedOrigins: ["https://ejemplo.com"] }]));
  });

  it("un dominio con formato inválido no entra a la lista ni viaja en el guardado", async () => {
    const patches: Record<string, unknown>[] = [];
    server.use(
      mockAgent([]),
      mockTokens(),
      http.patch(agentUrl, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeAgent());
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Dominio nuevo"), "ejemplo.com/contacto");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    // Mensaje puntual y no getByRole("alert"): la pantalla puede tener más
    // de un alerta a la vez (el aviso del token, un error de red).
    expect(await screen.findByText(/no es un dominio válido/)).toBeInTheDocument();
    expect(screen.queryByText("ejemplo.com/contacto")).not.toBeInTheDocument();

    // El error se ve SIN pegarle al backend; y si igual se guarda, lo que
    // viaja es la lista real, sin el texto rechazado.
    expect(patches).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Guardar dominios" }));
    await waitFor(() => expect(patches).toEqual([{ allowedOrigins: [] }]));
  });

  it("un dominio repetido avisa en vez de desaparecer en silencio", async () => {
    server.use(mockAgent(["https://ejemplo.com"]), mockTokens());

    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Dominio nuevo"), "https://EJEMPLO.com");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    expect(await screen.findByText(/ya está en la lista/)).toBeInTheDocument();
  });

  it("un PATCH fallido muestra el mensaje del backend y no pierde lo editado", async () => {
    server.use(
      mockAgent([]),
      mockTokens(),
      http.patch(agentUrl, () =>
        HttpResponse.json(
          { error: { message: "allowedOrigins no puede superar las 50 entradas" } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Dominio nuevo"), "https://ejemplo.com");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    await user.click(screen.getByRole("button", { name: "Guardar dominios" }));

    expect(
      await screen.findByText(/allowedOrigins no puede superar las 50 entradas/),
    ).toBeInTheDocument();
    expect(screen.getByText("https://ejemplo.com")).toBeInTheDocument();
  });
});

describe("AgentEmbedPage — tokens de embed", () => {
  it("lista los tokens con su prefijo, estado, último uso y creación", async () => {
    server.use(
      mockAgent([]),
      mockTokens([
        makeEmbedToken({
          id: "tok1",
          tokenPrefix: "embed_activo",
          lastUsedAt: "2026-02-10T12:00:00.000Z",
        }),
        makeEmbedToken({
          id: "tok2",
          tokenPrefix: "embed_viejo",
          revokedAt: "2026-02-05T09:00:00.000Z",
        }),
      ]),
    );
    renderPage();

    const filaActiva = (await screen.findByText(/embed_activo/)).closest("tr");
    expect(filaActiva).not.toBeNull();
    expect(within(filaActiva as HTMLElement).getByText("Activo")).toBeInTheDocument();
    // Un token revocado SIGUE en la lista: es información de auditoría.
    const filaRevocada = screen.getByText(/embed_viejo/).closest("tr");
    expect(within(filaRevocada as HTMLElement).getByText("Revocado")).toBeInTheDocument();
    // Solo el activo ofrece revocar: el backend responde 409 al segundo
    // intento y ofrecer una acción que solo puede fallar es peor que no
    // ofrecerla.
    expect(
      within(filaActiva as HTMLElement).getByRole("button", { name: "Revocar" }),
    ).toBeEnabled();
    expect(
      within(filaRevocada as HTMLElement).queryByRole("button", { name: "Revocar" }),
    ).not.toBeInTheDocument();
  });

  it("un token que nunca se usó lo dice, en vez de mostrar un vacío", async () => {
    server.use(mockAgent([]), mockTokens([makeEmbedToken({ lastUsedAt: null })]));
    renderPage();

    expect(await screen.findByText("Nunca")).toBeInTheDocument();
  });

  it("sin tokens lo dice explícitamente", async () => {
    server.use(mockAgent([]), mockTokens([]));
    renderPage();

    expect(
      await screen.findByText("Este agente todavía no tiene ningún token."),
    ).toBeInTheDocument();
  });

  it("generar un token muestra el token en claro UNA sola vez, y la tabla solo su prefijo", async () => {
    let tokens: EmbedToken[] = [];
    server.use(
      mockAgent([]),
      http.get(tokensUrl, () => HttpResponse.json({ data: tokens })),
      http.post(tokensUrl, () => {
        const creado = makeEmbedToken({ id: "tok9", tokenPrefix: "embed_9f3c1a2b" });
        tokens = [creado];
        return HttpResponse.json({ ...creado, token: TOKEN_EN_CLARO }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Generar token nuevo" }));

    // El token en claro, en su cuadro, con la advertencia de que es la única vez.
    expect(await screen.findByLabelText("Token")).toHaveValue(TOKEN_EN_CLARO);
    expect(screen.getByText(/única vez que vas a poder ver este token/)).toBeInTheDocument();

    // La lista refetcheada trae la fila nueva, pero con el PREFIJO: el token
    // en claro no está en esa respuesta ni puede estarlo.
    const fila = (await screen.findByText(/embed_9f3c1a2b…/)).closest("tr");
    expect(fila).not.toBeNull();
    expect(within(fila as HTMLElement).queryByText(TOKEN_EN_CLARO)).not.toBeInTheDocument();
    // Y en toda la pantalla el token completo aparece en UN solo lugar.
    expect(screen.getAllByDisplayValue(TOKEN_EN_CLARO)).toHaveLength(1);
  });

  it("el campo del token es readOnly pero NO disabled — seleccionarlo es el respaldo", async () => {
    server.use(
      mockAgent([]),
      mockTokens(),
      http.post(tokensUrl, () =>
        HttpResponse.json({ ...makeEmbedToken(), token: TOKEN_EN_CLARO }, { status: 201 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Generar token nuevo" }));

    const campo = await screen.findByLabelText("Token");
    expect(campo).toHaveAttribute("readonly");
    expect(campo).not.toBeDisabled();
  });

  it("Copiar manda el token entero al portapapeles y confirma", async () => {
    server.use(
      mockAgent([]),
      mockTokens(),
      http.post(tokensUrl, () =>
        HttpResponse.json({ ...makeEmbedToken(), token: TOKEN_EN_CLARO }, { status: 201 }),
      ),
    );

    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    mockClipboard(writeText);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Generar token nuevo" }));
    await screen.findByLabelText("Token");
    await user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(writeText).toHaveBeenCalledWith(TOKEN_EN_CLARO);
    expect(await screen.findByRole("button", { name: "¡Copiado!" })).toBeInTheDocument();
  });

  it("volviendo a la pantalla el token ya no está: solo queda su prefijo", async () => {
    const creado = makeEmbedToken({ id: "tok9", tokenPrefix: "embed_9f3c1a2b" });
    server.use(
      mockAgent([]),
      mockTokens([creado]),
      http.post(tokensUrl, () =>
        HttpResponse.json({ ...creado, token: TOKEN_EN_CLARO }, { status: 201 }),
      ),
    );

    const user = userEvent.setup();
    const primera = renderPage();
    await user.click(await screen.findByRole("button", { name: "Generar token nuevo" }));
    await screen.findByLabelText("Token");

    // Navegar afuera y volver es exactamente lo que el backend promete que
    // pierde el token: no se persiste en ningún lado, solo su hash.
    primera.unmount();
    renderPage();

    expect(await screen.findByText(/embed_9f3c1a2b…/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Token")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(TOKEN_EN_CLARO)).not.toBeInTheDocument();
    expect(codigoParaPegar()).toContain('data-embed-token="PEGÁ_ACÁ_TU_TOKEN"');
  });

  it("generar un segundo token reemplaza al primero: el anterior se pierde", async () => {
    const segundo = "embed_otro_token_completamente_distinto";
    let creados = 0;
    server.use(
      mockAgent([]),
      mockTokens(),
      http.post(tokensUrl, () => {
        creados += 1;
        return HttpResponse.json(
          { ...makeEmbedToken(), token: creados === 1 ? TOKEN_EN_CLARO : segundo },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Generar token nuevo" }));
    await waitFor(() => expect(screen.getByLabelText("Token")).toHaveValue(TOKEN_EN_CLARO));
    await user.click(screen.getByRole("button", { name: "Generar token nuevo" }));

    await waitFor(() => expect(screen.getByLabelText("Token")).toHaveValue(segundo));
    expect(screen.queryByDisplayValue(TOKEN_EN_CLARO)).not.toBeInTheDocument();
  });

  it("un POST fallido muestra el mensaje del backend y no inventa un token", async () => {
    server.use(
      mockAgent([]),
      mockTokens(),
      http.post(tokensUrl, () =>
        HttpResponse.json({ error: { message: "Agente no encontrado" } }, { status: 404 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Generar token nuevo" }));

    expect(await screen.findByText(/No pudimos generar el token/)).toHaveTextContent(
      "Agente no encontrado",
    );
    expect(screen.queryByLabelText("Token")).not.toBeInTheDocument();
  });
});

describe("AgentEmbedPage — revocar un token", () => {
  const confirmSpy = vi.spyOn(window, "confirm");

  beforeEach(() => {
    confirmSpy.mockReset();
  });

  afterEach(() => {
    confirmSpy.mockReset();
  });

  it("cancelar la confirmación no manda ningún DELETE", async () => {
    let borrados = 0;
    server.use(
      mockAgent([]),
      mockTokens([makeEmbedToken()]),
      http.delete(`${tokensUrl}/:tokenId`, () => {
        borrados += 1;
        return HttpResponse.json(makeEmbedToken({ revokedAt: "2026-02-11T00:00:00.000Z" }));
      }),
    );
    confirmSpy.mockReturnValue(false);

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Revocar" }));

    // El texto nombra la consecuencia que no se ve en la pantalla: el sitio
    // del cliente deja de funcionar hasta que se pegue el código de nuevo.
    expect(confirmSpy).toHaveBeenCalledWith(
      "¿Revocar este token? El widget que lo esté usando deja de responder de inmediato y hay que pegar el código de nuevo con un token nuevo.",
    );
    expect(borrados).toBe(0);
  });

  it("confirmando manda el DELETE del token correcto", async () => {
    const borrados: string[] = [];
    server.use(
      mockAgent([]),
      mockTokens([makeEmbedToken({ id: "tok7" })]),
      http.delete(`${tokensUrl}/:tokenId`, ({ params }) => {
        borrados.push(String(params.tokenId));
        return HttpResponse.json(
          makeEmbedToken({ id: "tok7", revokedAt: "2026-02-11T00:00:00.000Z" }),
        );
      }),
    );
    confirmSpy.mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Revocar" }));

    await waitFor(() => expect(borrados).toEqual(["tok7"]));
  });

  it("el 409 de 'ya estaba revocado' se lee como lo que es, y refresca la lista", async () => {
    let listados = 0;
    server.use(
      mockAgent([]),
      http.get(tokensUrl, () => {
        listados += 1;
        // A partir del segundo listado el token ya figura revocado: es la
        // carrera real que produjo el 409 (otra pestaña, otro ADMIN, o el
        // borrado del agente revocando en cascada).
        return HttpResponse.json({
          data: [makeEmbedToken(listados > 1 ? { revokedAt: "2026-02-11T00:00:00.000Z" } : {})],
        });
      }),
      http.delete(`${tokensUrl}/:tokenId`, () =>
        HttpResponse.json({ error: { message: "Este token ya fue revocado" } }, { status: 409 }),
      ),
    );
    confirmSpy.mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Revocar" }));

    expect(await screen.findByText(/No pudimos revocar el token/)).toHaveTextContent(
      "Este token ya fue revocado",
    );
    // La lista se refresca aunque la revocación haya fallado, así el cartel y
    // la tabla terminan diciendo lo mismo.
    expect(await screen.findByText("Revocado")).toBeInTheDocument();
    expect(listados).toBeGreaterThan(1);
  });
});

describe("AgentEmbedPage — código para instalar", () => {
  it("el snippet trae el id real del agente y el origen desde el que se ve el CRM", async () => {
    server.use(mockAgent(["https://ejemplo.com"]), mockTokens());
    renderPage();

    await screen.findByText("https://ejemplo.com");
    const codigo = codigoParaPegar();
    expect(codigo).toContain('data-agent-id="ag1"');
    // NO un dominio de Vercel escrito a mano: el widget se sirve del mismo
    // deploy que la SPA, así que el origen actual es por construcción el
    // correcto.
    expect(codigo).toContain(`src="${window.location.origin}/widget.js"`);
    expect(codigo).toContain("async");
  });

  it("sin token en claro el snippet lleva un marcador, nunca el prefijo", async () => {
    server.use(
      mockAgent(["https://ejemplo.com"]),
      mockTokens([makeEmbedToken({ tokenPrefix: "embed_abc123" })]),
    );
    renderPage();

    await screen.findByText(/embed_abc123…/);
    const codigo = codigoParaPegar();
    expect(codigo).toContain('data-embed-token="PEGÁ_ACÁ_TU_TOKEN"');
    // El prefijo NO sirve para autenticar: ponerlo acá sugeriría que sí.
    expect(codigo).not.toContain("embed_abc123");
    expect(
      screen.getByText(/un token solo se puede ver en el momento de generarlo/),
    ).toBeInTheDocument();
  });

  it("el token recién generado entra solo en el snippet", async () => {
    server.use(
      mockAgent(["https://ejemplo.com"]),
      mockTokens(),
      http.post(tokensUrl, () =>
        HttpResponse.json({ ...makeEmbedToken(), token: TOKEN_EN_CLARO }, { status: 201 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Generar token nuevo" }));
    await screen.findByLabelText("Token");

    expect(codigoParaPegar()).toContain(`data-embed-token="${TOKEN_EN_CLARO}"`);
  });

  it("Copiar código copia el snippet entero", async () => {
    server.use(mockAgent(["https://ejemplo.com"]), mockTokens());

    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    mockClipboard(writeText);
    renderPage();

    await screen.findByText("https://ejemplo.com");
    await user.click(screen.getByRole("button", { name: "Copiar código" }));

    expect(writeText).toHaveBeenCalledWith(codigoParaPegar());
  });

  it("sin dominios GUARDADOS advierte que el código todavía no va a funcionar", async () => {
    server.use(mockAgent([]), mockTokens());
    renderPage();

    expect(
      await screen.findByText(
        "Este código todavía no va a funcionar: falta agregar al menos un dominio en el paso 1 y guardarlo.",
      ),
    ).toBeInTheDocument();
  });

  it("la advertencia mira lo GUARDADO: agregar un dominio sin guardar no la apaga", async () => {
    let allowedOrigins: string[] = [];
    server.use(
      http.get(agentUrl, () => HttpResponse.json(makeAgent({ allowedOrigins }))),
      mockTokens(),
      http.patch(agentUrl, async ({ request }) => {
        const body = (await request.json()) as { allowedOrigins: string[] };
        allowedOrigins = body.allowedOrigins;
        return HttpResponse.json(makeAgent({ allowedOrigins }));
      }),
    );

    const user = userEvent.setup();
    renderPage();

    const aviso =
      "Este código todavía no va a funcionar: falta agregar al menos un dominio en el paso 1 y guardarlo.";
    await user.type(await screen.findByLabelText("Dominio nuevo"), "https://ejemplo.com");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    // El chip ya está en la lista, pero lo que decide si el widget carga es lo
    // que está en la base.
    expect(screen.getByText(aviso)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar dominios" }));
    await waitFor(() => expect(screen.queryByText(aviso)).not.toBeInTheDocument());
  });
});

describe("AgentEmbedPage — estados de la pantalla", () => {
  it("estado de carga", () => {
    server.use(
      http.get(agentUrl, () => new Promise(() => undefined)),
      mockTokens(),
    );
    renderPage();
    expect(screen.getAllByText("Cargando…").length).toBeGreaterThan(0);
  });

  it("estado de error del agente, con el mensaje real del backend", async () => {
    server.use(
      http.get(agentUrl, () =>
        HttpResponse.json({ error: { message: "Agente no encontrado" } }, { status: 404 }),
      ),
      mockTokens(),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Agente no encontrado");
  });

  it("si falla el listado de tokens, el resto de la pantalla sigue en pie", async () => {
    server.use(
      mockAgent(["https://ejemplo.com"]),
      http.get(tokensUrl, () =>
        HttpResponse.json({ error: { message: "Se rompió todo" } }, { status: 500 }),
      ),
    );
    renderPage();

    expect(await screen.findByText(/No pudimos cargar los tokens/)).toHaveTextContent(
      "Se rompió todo",
    );
    // Los dominios y el código siguen ahí: son independientes de los tokens.
    expect(screen.getByRole("button", { name: "Quitar https://ejemplo.com" })).toBeInTheDocument();
    expect(codigoParaPegar()).toContain('data-agent-id="ag1"');
  });
});

// Misma jerarquía real que app/router.tsx (ProtectedRoute → AdminRoute →
// AgentEmbedPage), con el destino del redirect reemplazado por un placeholder.
// Acá importa más que en el listado: las tres rutas de tokens son ADMIN-only
// en el backend, la LECTURA incluida.
function renderUnderAdminRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agents/ag1/embed"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/companies" element={<div>lista de empresas</div>} />
            <Route element={<AdminRoute />}>
              <Route path="/agents/:id/embed" element={<AgentEmbedPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentEmbedPage — bajo AdminRoute", () => {
  it("un USER es redirigido y NO se piden los tokens", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let listados = 0;
    server.use(
      mockAgent([]),
      http.get(tokensUrl, () => {
        listados += 1;
        return HttpResponse.json({ data: [] });
      }),
    );

    renderUnderAdminRoute();

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(listados).toBe(0);
  });

  it("un ADMIN sí ve la pantalla", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(mockAgent([]), mockTokens([makeEmbedToken()]));

    renderUnderAdminRoute();

    expect(
      await screen.findByRole("heading", { name: "Instalar el widget en un sitio" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/embed_abc123…/)).toBeInTheDocument();
  });
});
