import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeAgent } from "../../test/agentFixtures";
import { makeBranch } from "../../test/branchFixtures";
import { makeConversation, makeConversationDetail } from "../../test/conversationFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { ConversationListPage } from "./ConversationListPage";
import type { ConversationListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// El pop up monta ConversationDetail, que lee useAuth para decidir si el
// contacto va con link a su ficha (ADMIN-only). La bandeja en sí no usa auth.
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

useAuthMock.mockReturnValue({
  status: "authenticated",
  me: {
    id: "u1",
    email: "a@x.com",
    fullName: "A",
    organizationId: "org-1",
    role: "ADMIN",
    isPlatformAdmin: false,
  },
  accountUnavailableReason: null,
  profileError: null,
  login: vi.fn(),
  logout: vi.fn(),
  retryProfile: vi.fn(),
});

const baseUrl = `${env.apiUrl}/api/conversations`;
const detailUrl = `${env.apiUrl}/api/conversations/conv-1`;
const branchesUrl = `${env.apiUrl}/api/branches`;
const agentsUrl = `${env.apiUrl}/api/agents`;

// El pop up NO toca la URL, y eso es parte del contrato del ítem 73: hace
// falta poder afirmarlo, no suponerlo. Este espía renderiza la ubicación
// actual del MemoryRouter en un nodo aparte para poder leerla desde cualquier
// caso.
function EspiaDeUbicacion() {
  const location = useLocation();
  return <span data-testid="ubicacion">{location.pathname + location.search}</span>;
}

function ubicacion(): string {
  return screen.getByTestId("ubicacion").textContent ?? "";
}

function listResponse(overrides: Partial<ConversationListResponse> = {}): ConversationListResponse {
  return {
    data: [makeConversation()],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

// La pantalla pide sucursales y agentes además de conversaciones: alimentan
// los dos selectores de filtro. Los nombres de las FILAS no salen de acá —
// vienen resueltos en la propia respuesta del listado (conversationInclude).
function mockFiltros() {
  return [
    http.get(branchesUrl, () =>
      HttpResponse.json({
        data: [
          makeBranch({ id: "branch-1", name: "Centro" }),
          makeBranch({ id: "b2", name: "Costa" }),
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    ),
    http.get(agentsUrl, () =>
      HttpResponse.json({
        data: [makeAgent({ id: "agent-1", name: "Vera" }), makeAgent({ id: "ag2", name: "Nilo" })],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    ),
  ];
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/conversations"]}>
        <ConversationListPage />
        <EspiaDeUbicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConversationListPage", () => {
  it("muestra contacto, canal, estado, sucursal, agente y último mensaje", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage();

    const fila = (await screen.findByText("Ana Pérez")).closest("tr");
    // El canal traducido con la misma etiqueta que usa el módulo de agentes,
    // no el valor crudo del enum.
    expect(cellByHeader(fila, "Canal")).toHaveTextContent("WhatsApp");
    expect(cellByHeader(fila, "Canal")).not.toHaveTextContent("WHATSAPP");
    expect(cellByHeader(fila, "Estado")?.querySelector(".ds-badge")).toHaveTextContent("Activa");
    expect(cellByHeader(fila, "Sucursal")).toHaveTextContent("Centro");
    expect(cellByHeader(fila, "Agente")).toHaveTextContent("Vera");
    expect(cellByHeader(fila, "Último mensaje")).not.toHaveTextContent("—");
  });

  it("los tres estados tienen su etiqueta propia; derivada dice a quién", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [
              makeConversation({ id: "c1", status: "ACTIVE" }),
              makeConversation({
                id: "c2",
                status: "TRANSFERRED_TO_HUMAN",
                contact: { id: "contact-2", firstName: "Bruno", lastName: "Giménez" },
              }),
              makeConversation({
                id: "c3",
                status: "CLOSED",
                contact: { id: "contact-3", firstName: "Carla", lastName: "Soto" },
              }),
            ],
          }),
        ),
      ),
    );

    renderPage();

    const derivada = (await screen.findByText("Bruno Giménez")).closest("tr");
    expect(cellByHeader(derivada, "Estado")).toHaveTextContent("Derivada a un humano");
    const cerrada = screen.getByText("Carla Soto").closest("tr");
    expect(cellByHeader(cerrada, "Estado")).toHaveTextContent("Cerrada");
  });

  // -------------------------------------------------------------------------
  // El pop up (ítem 73): clickear una fila ya no navega a /conversations/:id.
  // -------------------------------------------------------------------------

  it("clickear el contacto abre el hilo en un pop up SIN navegar: la URL no cambia", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
      http.get(detailUrl, () => HttpResponse.json(makeConversationDetail())),
    );

    const user = userEvent.setup();
    renderPage();

    // Ya no es un link: es un botón, porque no lleva a ninguna parte.
    const abrir = await screen.findByRole("button", { name: "Ana Pérez" });
    expect(screen.queryByRole("link", { name: "Ana Pérez" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(abrir);

    const popup = await screen.findByRole("dialog");
    expect(within(popup).getByText("Hola, quiero saber el precio")).toBeInTheDocument();
    // Lo que el ítem promete: se abrió el hilo y el listado sigue donde estaba.
    expect(ubicacion()).toBe("/conversations");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("cerrar el pop up vuelve al listado, sin navegar tampoco al cerrar", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
      http.get(detailUrl, () => HttpResponse.json(makeConversationDetail())),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Ana Pérez" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ubicacion()).toBe("/conversations");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("el detalle NO se pide hasta que alguien abre una fila", async () => {
    let pedidosDelDetalle = 0;
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
      http.get(detailUrl, () => {
        pedidosDelDetalle += 1;
        return HttpResponse.json(makeConversationDetail());
      }),
    );

    const user = userEvent.setup();
    renderPage();

    // El pop up se monta recién al clickear, así que una bandeja con 20 filas
    // no dispara 20 requests del hilo completo.
    await screen.findByRole("button", { name: "Ana Pérez" });
    expect(pedidosDelDetalle).toBe(0);

    await user.click(screen.getByRole("button", { name: "Ana Pérez" }));
    await screen.findByRole("dialog");
    expect(pedidosDelDetalle).toBe(1);
  });

  // -------------------------------------------------------------------------
  // El brief en la fila (ítem 73)
  // -------------------------------------------------------------------------

  it("el brief aparece truncado bajo el nombre del contacto", async () => {
    const largo = `Ana preguntó por el precio del Corolla automático y por la financiación. ${"El agente le pasó la lista y le ofreció una prueba de manejo. ".repeat(5)}`;
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () =>
        HttpResponse.json(listResponse({ data: [makeConversation({ brief: largo })] })),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Ana Pérez")).closest("tr");
    const resumen = fila?.querySelector(".ds-cell-secondary");
    expect(resumen).toHaveTextContent("Ana preguntó por el precio del Corolla automático");
    // Truncado, no el brief entero pegado en la celda.
    expect(resumen?.textContent).toContain("…");
    expect(resumen!.textContent!.length).toBeLessThan(largo.length);
  });

  it("una conversación sin brief no muestra una segunda línea vacía", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () => HttpResponse.json(listResponse({ data: [makeConversation()] }))),
    );

    renderPage();

    const fila = (await screen.findByText("Ana Pérez")).closest("tr");
    expect(fila?.querySelector(".ds-cell-secondary")).toBeNull();
  });

  it("una conversación sin mensajes todavía muestra un guión, no una fecha inventada", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () =>
        HttpResponse.json(listResponse({ data: [makeConversation({ lastMessageAt: null })] })),
      ),
    );

    renderPage();

    const fila = (await screen.findByText("Ana Pérez")).closest("tr");
    expect(cellByHeader(fila, "Último mensaje")).toHaveTextContent("—");
  });

  it("NO ofrece ninguna acción: la bandeja se lee, no se escribe", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage();
    const tabla = within(await screen.findByRole("table"));

    // La barrera del ítem, del lado de la pantalla: sin "Nueva conversación",
    // sin columna Acciones y sin menú de 3 puntos. Responder o cerrar una
    // conversación exige antes poder ENTREGAR el mensaje por el canal.
    expect(screen.queryByRole("link", { name: /Nueva/ })).not.toBeInTheDocument();
    expect(tabla.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(tabla.queryByRole("button", { name: "Acciones" })).not.toBeInTheDocument();
  });

  it("los filtros viajan en la query y resetean la página a 1", async () => {
    const urls: URL[] = [];
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(
          listResponse({ pagination: { page: 1, pageSize: 20, total: 60, totalPages: 3 } }),
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Pérez");

    // Página 2 primero: así se puede verificar que cada filtro la devuelve a 1.
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("page")).toBe("2"));

    await user.type(screen.getByPlaceholderText("Buscar por contacto"), "ana");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("search")).toBe("ana"));
    expect(urls.at(-1)?.searchParams.get("page")).toBe("1");

    await chooseSelectOption(user, screen.getByLabelText("Estado"), "Derivada a un humano");
    await waitFor(() =>
      expect(urls.at(-1)?.searchParams.get("status")).toBe("TRANSFERRED_TO_HUMAN"),
    );

    await chooseSelectOption(user, screen.getByLabelText("Canal"), "Web");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("channel")).toBe("WEB"));

    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Costa");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("branchId")).toBe("b2"));

    await chooseSelectOption(user, screen.getByLabelText("Agente"), "Nilo");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("agentId")).toBe("ag2"));

    // Los filtros anteriores siguen puestos: se combinan, no se pisan.
    const ultima = urls.at(-1)!;
    expect(ultima.searchParams.get("search")).toBe("ana");
    expect(ultima.searchParams.get("status")).toBe("TRANSFERRED_TO_HUMAN");
    expect(ultima.searchParams.get("page")).toBe("1");
  });

  it("el filtro vacío no viaja: 'Todos' vuelve a no filtrar", async () => {
    const urls: URL[] = [];
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(listResponse());
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Pérez");

    await chooseSelectOption(user, screen.getByLabelText("Canal"), "Web");
    await waitFor(() => expect(urls.at(-1)?.searchParams.get("channel")).toBe("WEB"));

    await chooseSelectOption(user, screen.getByLabelText("Canal"), "Todos");
    await waitFor(() => expect(urls.at(-1)?.searchParams.has("channel")).toBe(false));
  });

  it("sin resultados muestra el estado vacío, no una tabla en blanco", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () =>
        HttpResponse.json(
          listResponse({
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );

    renderPage();

    expect(await screen.findByText("No hay conversaciones para mostrar.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("un error del backend se muestra con su mensaje", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "Falló la consulta" } }, { status: 500 }),
      ),
    );

    renderPage();

    expect(await screen.findByText(/No pudimos cargar las conversaciones/)).toHaveTextContent(
      "Falló la consulta",
    );
  });
});
