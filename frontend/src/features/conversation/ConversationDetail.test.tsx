import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// El segundo uso del componente (ítem 73): montado a mano con el id por prop,
// como lo hace el Modal de la bandeja. SIN una <Route> que lo provea — es
// exactamente la diferencia que el prop existe para permitir.
function renderComoPopup(role: "ADMIN" | "USER" = "ADMIN") {
  useAuthMock.mockReturnValue(mockAuth(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/conversations"]}>
        <ConversationDetail id="conv-1" />
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

    // La barrera del ítem 66: responder exige poder ENTREGAR el mensaje por el
    // canal (el widget Web solo contesta a su propio mensaje; WhatsApp no
    // existe todavía). Si alguien agrega una caja de texto para CONTESTAR sin
    // resolver eso primero, este test se cae y obliga a pensarlo.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enviar|Responder|Cerrar conversación/ }),
    ).toBeNull();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("el editor del brief NO es una caja para responder: la barrera sigue en pie", async () => {
    // El ítem 73 trajo el único textarea de esta pantalla. Este caso lo abre a
    // propósito y comprueba que aun ASÍ no hay forma de contestarle al
    // contacto: lo que se edita es una anotación interna, y no aparece ningún
    // "Enviar".
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Ana preguntó el precio." }, HILO)),
      ),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Editar" }));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enviar|Responder|Cerrar conversación/ }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // El brief (ítem 73)
  // -------------------------------------------------------------------------

  it("sin brief, ofrece generarlo en vez de mostrar una tarjeta vacía", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();

    expect(await screen.findByText(/todavía no tiene un resumen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar resumen" })).toBeInTheDocument();
    // Nada que editar todavía.
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("con brief, lo muestra arriba del hilo con Editar y Regenerar", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Ana preguntó por el Corolla." }, HILO)),
      ),
    );

    renderDetail();

    const resumen = await screen.findByText("Ana preguntó por el Corolla.");
    expect(resumen).toHaveClass("ds-brief-text");
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerar resumen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generar resumen" })).not.toBeInTheDocument();

    // ANTES del hilo: es la pregunta que trae a alguien a esta pantalla.
    const hilo = screen.getByRole("list", { name: "Mensajes de la conversación" });
    expect(resumen.compareDocumentPosition(hilo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("un brief de la IA no se marca como editado a mano", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Ana preguntó por el Corolla." }, HILO)),
      ),
    );

    renderDetail();

    await screen.findByText("Ana preguntó por el Corolla.");
    expect(screen.queryByText(/Editado a mano/)).not.toBeInTheDocument();
  });

  it("un brief corregido a mano lo dice, y con el nombre de quien lo hizo", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail(
            {
              brief: "Ana quería el Corolla automático.",
              briefEditedByUserId: "u9",
              briefEditedBy: { id: "u9", fullName: "Sofía Rodríguez" },
            },
            HILO,
          ),
        ),
      ),
    );

    renderDetail();

    expect(await screen.findByText(/Editado a mano por Sofía Rodríguez/)).toBeInTheDocument();
  });

  it("editar y guardar manda el PATCH con el texto nuevo", async () => {
    const cuerpos: unknown[] = [];
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Resumen viejo." }, HILO)),
      ),
      http.patch(detailUrl, async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json(
          makeConversationDetail(
            {
              brief: "Resumen corregido.",
              briefEditedByUserId: "u1",
              briefEditedBy: { id: "u1", fullName: "A" },
            },
            HILO,
          ),
        );
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const textarea = screen.getByRole("textbox");
    // El textarea arranca con el brief que había, no en blanco: editar es
    // corregir, no volver a escribir.
    expect(textarea).toHaveValue("Resumen viejo.");

    await user.clear(textarea);
    await user.type(textarea, "Resumen corregido.");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(cuerpos).toHaveLength(1));
    expect(cuerpos[0]).toEqual({ brief: "Resumen corregido." });

    // Vuelve al modo lectura con el texto nuevo y ya marcado como editado.
    expect(await screen.findByText("Resumen corregido.")).toBeInTheDocument();
    expect(screen.getByText(/Editado a mano/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("guardar el textarea vacío manda null y vuelve a ofrecer generarlo", async () => {
    const cuerpos: unknown[] = [];
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Resumen viejo." }, HILO)),
      ),
      http.patch(detailUrl, async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json(makeConversationDetail({ brief: null }, HILO));
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await user.clear(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(cuerpos).toHaveLength(1));
    // null y no "": es como se vacía, y el backend distingue los dos.
    expect(cuerpos[0]).toEqual({ brief: null });
    expect(await screen.findByRole("button", { name: "Generar resumen" })).toBeInTheDocument();
  });

  it("cancelar no manda nada y deja el brief como estaba", async () => {
    let patches = 0;
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Resumen viejo." }, HILO)),
      ),
      http.patch(detailUrl, () => {
        patches += 1;
        return HttpResponse.json(makeConversationDetail({ brief: "no debería pasar" }, HILO));
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "algo que no se guarda");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(patches).toBe(0);
    expect(screen.getByText("Resumen viejo.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("'Generar resumen' llama al POST y muestra el resumen que vuelve", async () => {
    let generaciones = 0;
    server.use(
      http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))),
      http.post(`${detailUrl}/generate-brief`, () => {
        generaciones += 1;
        return HttpResponse.json(
          makeConversationDetail({ brief: "Ana preguntó el precio del Corolla." }, HILO),
        );
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Generar resumen" }));

    expect(await screen.findByText("Ana preguntó el precio del Corolla.")).toBeInTheDocument();
    expect(generaciones).toBe(1);
  });

  it("'Regenerar' sobre un brief de la IA no pregunta nada y pisa el texto", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Resumen viejo." }, HILO)),
      ),
      http.post(`${detailUrl}/generate-brief`, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Resumen nuevo." }, HILO)),
      ),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Regenerar resumen" }));

    expect(await screen.findByText("Resumen nuevo.")).toBeInTheDocument();
    // No hay nada que perder: el texto que se pisa lo había escrito el modelo.
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("'Regenerar' sobre una edición a mano pregunta antes, y cancelar no llama al backend", async () => {
    let generaciones = 0;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail(
            {
              brief: "Lo corregí yo.",
              briefEditedByUserId: "u9",
              briefEditedBy: { id: "u9", fullName: "Sofía Rodríguez" },
            },
            HILO,
          ),
        ),
      ),
      http.post(`${detailUrl}/generate-brief`, () => {
        generaciones += 1;
        return HttpResponse.json(makeConversationDetail({ brief: "Resumen nuevo." }, HILO));
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Regenerar resumen" }));

    // Es la única acción de la tarjeta que destruye algo que escribió una
    // persona, así que pregunta — y decir que no la deja intacta.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(generaciones).toBe(0);
    expect(screen.getByText("Lo corregí yo.")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("si generar falla, el brief que había sigue a la vista con el error al lado", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ brief: "Resumen viejo." }, HILO)),
      ),
      http.post(`${detailUrl}/generate-brief`, () =>
        HttpResponse.json(
          { error: { message: "No se pudo contactar a OpenRouter" } },
          { status: 502 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Regenerar resumen" }));

    expect(await screen.findByText(/No pudimos generar el resumen/)).toHaveTextContent(
      "No se pudo contactar a OpenRouter",
    );
    // Lo importante: no se perdió lo que había.
    expect(screen.getByText("Resumen viejo.")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Los dos usos del componente (ítem 73)
  // -------------------------------------------------------------------------

  it("con el prop `id` muestra lo mismo que con useParams, y sin el encabezado de página", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderComoPopup();

    // Los mismos datos y el mismo hilo que la ruta.
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Hola, quiero saber el precio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar resumen" })).toBeInTheDocument();

    // Lo único que cambia: adentro del pop up el encabezado lo pone el Modal.
    expect(screen.queryByRole("heading", { name: "Conversación" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Volver a Conversaciones" })).not.toBeInTheDocument();
  });

  it("como ruta sí lleva el encabezado y el link de vuelta", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();

    expect(await screen.findByRole("heading", { name: "Conversación" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Conversaciones" })).toHaveAttribute(
      "href",
      "/conversations",
    );
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
