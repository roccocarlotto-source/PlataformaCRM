import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeConversationDetail, makeMessage } from "../../test/conversationFixtures";
import type { AuthContextValue } from "../../auth/AuthContext";
import { ConversationDetail } from "./ConversationDetail";
import type { ConversationMessage } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

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

const detailUrl = `${env.apiUrl}/api/conversations/conv-1`;

// El hilo de ejemplo: el contacto escribe, el agente contesta ejecutando una
// tool, y después de una derivación contesta una persona de la organización.
// Los tres senderType posibles en un solo caso.
const HILO: ConversationMessage[] = [
  makeMessage({ id: "m1", content: "Hola, quiero saber el precio" }),
  makeMessage({
    id: "m2",
    direction: "OUTBOUND",
    senderType: "AGENT",
    content: "Te armo una oportunidad y te escribe un vendedor",
    toolCalls: [
      {
        id: "call-1",
        name: "create_opportunity",
        arguments: { title: "Corolla" },
        allowed: true,
        result: { ok: true, data: { opportunityId: "op-1" } },
      },
    ],
    createdAt: "2026-03-03T09:59:00.000Z",
  }),
  makeMessage({
    id: "m3",
    direction: "OUTBOUND",
    senderType: "HUMAN",
    senderUserId: "u9",
    senderUser: { id: "u9", fullName: "Sofía Rodríguez" },
    content: "Hola Ana, sigo yo desde acá",
    createdAt: "2026-03-03T10:00:00.000Z",
  }),
];

function renderDetail(role: "ADMIN" | "USER" = "ADMIN") {
  useAuthMock.mockReturnValue(mockAuth(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/conversations/conv-1"]}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function burbujaDe(texto: string): HTMLElement {
  const burbuja = screen.getByText(texto, { selector: ".ds-chat-bubble" });
  return burbuja;
}

describe("ConversationDetail", () => {
  it("el encabezado dice con quién es, por dónde, en qué estado y quién la atendió", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toHaveClass("ds-badge");
    expect(screen.getByText("Centro")).toBeInTheDocument();
    expect(screen.getByText("Vera")).toBeInTheDocument();
  });

  it("para un ADMIN el contacto es un link a su ficha", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail("ADMIN");

    expect(await screen.findByRole("link", { name: "Ana Pérez" })).toHaveAttribute(
      "href",
      "/contacts/contact-1/edit",
    );
  });

  it("para un USER el contacto se muestra sin link: su ficha es ADMIN-only", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail("USER");

    // El dato está a la vista igual; lo que no está es un link que lo
    // mandaría a /companies por AdminRoute.
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ana Pérez" })).not.toBeInTheDocument();
  });

  it("los mensajes van en orden cronológico, con el autor de cada uno", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();

    const hilo = await screen.findByRole("list", { name: "Mensajes de la conversación" });
    const textos = within(hilo)
      .getAllByText(/Hola, quiero saber el precio|Te armo una oportunidad|sigo yo desde acá/)
      .map((nodo) => nodo.textContent);
    expect(textos).toHaveLength(3);
    expect(textos[0]).toContain("Hola, quiero saber el precio");
    expect(textos[2]).toContain("sigo yo desde acá");

    // Cada burbuja dice quién la escribió: el contacto por su nombre, el
    // agente por el suyo, y la persona que tomó la conversación por el suyo.
    expect(burbujaDe("Hola, quiero saber el precio")).toHaveTextContent("Ana Pérez");
    expect(burbujaDe("Te armo una oportunidad y te escribe un vendedor")).toHaveTextContent("Vera");
    expect(burbujaDe("Hola Ana, sigo yo desde acá")).toHaveTextContent("Sofía Rodríguez");
  });

  it("el lado lo decide la dirección, y el mensaje de una persona se distingue del del agente", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();

    const delContacto = (
      await screen.findByText("Hola, quiero saber el precio", {
        selector: ".ds-chat-bubble",
      })
    ).closest(".ds-chat-row");
    expect(delContacto).toHaveClass("ds-chat-row--contacto");

    const delAgente = burbujaDe("Te armo una oportunidad y te escribe un vendedor");
    expect(delAgente.closest(".ds-chat-row")).toHaveClass("ds-chat-row--agente");
    expect(delAgente).not.toHaveClass("ds-chat-bubble--humano");

    const deLaPersona = burbujaDe("Hola Ana, sigo yo desde acá");
    // Mismo lado que el agente —los dos son el negocio— y distinguible.
    expect(deLaPersona.closest(".ds-chat-row")).toHaveClass("ds-chat-row--agente");
    expect(deLaPersona).toHaveClass("ds-chat-bubble--humano");
  });

  it("un mensaje HUMAN sin usuario resoluble no queda sin autor", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({}, [
            makeMessage({
              id: "m1",
              direction: "OUTBOUND",
              senderType: "HUMAN",
              senderUserId: "u9",
              senderUser: null,
              content: "Te llamo en un rato",
            }),
          ]),
        ),
      ),
    );

    renderDetail();

    expect(await screen.findByText(/Un integrante del equipo/)).toBeInTheDocument();
  });

  it("las tool calls guardadas se muestran igual de compactas que en el probador", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();

    const bloque = (await screen.findByText("Crear oportunidad")).closest(".ds-chat-tool");
    expect(bloque).not.toBeNull();
    const dentro = within(bloque as HTMLElement);
    // El rótulo en castellano Y el nombre crudo, como en el playground.
    expect(dentro.getByText("create_opportunity")).toBeInTheDocument();
    expect(dentro.getByText(/Argumentos:/)).toHaveTextContent('{"title":"Corolla"}');
    expect(dentro.getByText(/Resultado:/)).toHaveTextContent('{"opportunityId":"op-1"}');
  });

  it("una tool bloqueada por las reglas del agente dice el motivo", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({}, [
            makeMessage({
              id: "m1",
              direction: "OUTBOUND",
              senderType: "AGENT",
              content: "No puedo hacer eso",
              toolCalls: [
                {
                  id: "call-1",
                  name: "update_opportunity",
                  arguments: {},
                  allowed: false,
                  reason: "acción prohibida por los guardrails",
                },
              ],
            }),
          ]),
        ),
      ),
    );

    renderDetail();

    expect(
      await screen.findByText(/Bloqueada por las reglas del agente: acción prohibida/),
    ).toBeInTheDocument();
  });

  it("un toolCalls con una forma que no reconocemos se muestra crudo, no se esconde", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({}, [
            makeMessage({
              id: "m1",
              direction: "OUTBOUND",
              senderType: "AGENT",
              content: "Listo",
              // Sin `name`: no es una tool call reconocible. El dato real
              // informa más que su ausencia.
              toolCalls: [{ herramienta: "algo_nuevo" }],
            }),
          ]),
        ),
      ),
    );

    renderDetail();

    expect(await screen.findByText(/Herramientas:/)).toHaveTextContent(
      '[{"herramienta":"algo_nuevo"}]',
    );
  });

  it("una conversación sin mensajes se abre igual y lo dice", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ lastMessageAt: null }, [])),
      ),
    );

    renderDetail();

    expect(
      await screen.findByText("Esta conversación todavía no tiene mensajes."),
    ).toBeInTheDocument();
  });

  it("NO hay ningún control para escribir o responder en esta pantalla", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();
    await screen.findByText("Ana Pérez");

    // La barrera del ítem: responder exige poder ENTREGAR el mensaje por el
    // canal (el widget Web solo contesta a su propio mensaje; WhatsApp no
    // existe todavía). Si alguien agrega una caja de texto sin resolver eso
    // primero, este test se cae y obliga a pensarlo.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enviar|Responder|Cerrar conversación/ }),
    ).toBeNull();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("un error al cargar se muestra con el mensaje del backend", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json({ error: { message: "Conversación no encontrada" } }, { status: 404 }),
      ),
    );

    renderDetail();

    expect(await screen.findByText(/No pudimos cargar la conversación/)).toHaveTextContent(
      "Conversación no encontrada",
    );
  });
});
