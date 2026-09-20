import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeAgent } from "../../test/agentFixtures";
import { makeBranch } from "../../test/branchFixtures";
import { makeConversation } from "../../test/conversationFixtures";
import { cellByHeader } from "../../test/cellByHeader";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { ConversationListPage } from "./ConversationListPage";
import type { ConversationListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/conversations`;
const branchesUrl = `${env.apiUrl}/api/branches`;
const agentsUrl = `${env.apiUrl}/api/agents`;

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
      <MemoryRouter>
        <ConversationListPage />
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

  it("el nombre del contacto lleva al hilo de esa conversación", async () => {
    server.use(
      ...mockFiltros(),
      http.get(baseUrl, () => HttpResponse.json(listResponse())),
    );

    renderPage();

    expect(await screen.findByRole("link", { name: "Ana Pérez" })).toHaveAttribute(
      "href",
      "/conversations/conv-1",
    );
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
