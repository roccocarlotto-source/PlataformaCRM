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
      canUseInternalAgent: false,
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
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/conversations/conv-1"]}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // El QueryClient sale para los tests del polling: un refetchQueries() a mano
  // es exactamente lo que dispara el refetchInterval, sin esperar 5 s reales.
  return { ...utils, queryClient };
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

  // WA-1 (docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)): remitente y estado de entrega.
  it("un mensaje de una automatización se rotula 'Automatización', no con el nombre del agente", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({}, [
            makeMessage({
              id: "m1",
              direction: "OUTBOUND",
              senderType: "AUTOMATION",
              content: "Gracias por tu compra",
              deliveryStatus: "SENT",
            }),
          ]),
        ),
      ),
    );

    renderDetail();

    const autor = await screen.findByText(/Automatización ·/);
    expect(autor.closest(".ds-chat-row")).toHaveClass("ds-chat-row--agente");
  });

  it("cada saliente muestra su estado de entrega, y un fallido deja ver el motivo", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({}, [
            makeMessage({ id: "m1", content: "Hola" }),
            makeMessage({
              id: "m2",
              direction: "OUTBOUND",
              senderType: "AGENT",
              content: "¡Hola! ¿En qué te ayudo?",
              deliveryStatus: "READ",
            }),
            makeMessage({
              id: "m3",
              direction: "OUTBOUND",
              senderType: "AGENT",
              content: "¿Seguís ahí?",
              deliveryStatus: "FAILED",
              deliveryError: "(131047) Re-engagement message",
            }),
          ]),
        ),
      ),
    );

    renderDetail();

    expect(await screen.findByText(/· Leído/)).toBeInTheDocument();
    const fallido = screen.getByText(/· No entregado/);
    expect(fallido).toHaveAttribute("title", "(131047) Re-engagement message");
    // El entrante no tiene estado de entrega.
    expect(screen.queryByText(/· Enviado/)).not.toBeInTheDocument();
  });

  // Lo que se vio en producción: el resultado de search_vehicles, con códigos
  // internos y precios de lista, como JSON en el hilo. Datos ficticios.
  const BUSQUEDA: ConversationMessage = makeMessage({
    id: "m2",
    direction: "OUTBOUND",
    senderType: "AGENT",
    content: "Tenemos dos Corolla disponibles",
    toolCalls: [
      {
        id: "call-1",
        name: "search_vehicles",
        arguments: { query: "Corolla" },
        allowed: true,
        result: {
          ok: true,
          data: [{ id: "v1", internalCode: "INT-0001", priceListUsd: 12345 }],
        },
      },
      { herramienta: "forma_que_no_reconocemos" },
    ],
  });

  it.each(["ADMIN", "USER"] as const)(
    "el hilo no muestra herramientas ni JSON (%s): solo el texto del agente",
    async (role) => {
      server.use(
        http.get(detailUrl, () =>
          HttpResponse.json(makeConversationDetail({}, [makeMessage({ id: "m1" }), BUSQUEDA])),
        ),
      );

      const { container } = renderDetail(role);

      expect(
        await screen.findByText("Tenemos dos Corolla disponibles", { selector: ".ds-chat-bubble" }),
      ).toBeInTheDocument();
      expect(container.querySelector(".ds-chat-tool")).toBeNull();
      expect(container.querySelector(".ds-chat-row--tool")).toBeNull();
      const hilo = screen.getByRole("list", { name: "Mensajes de la conversación" });
      for (const rastro of [
        "search_vehicles",
        "Buscar vehículos",
        "internalCode",
        "priceListUsd",
        "INT-0001",
        "Argumentos:",
        "Resultado:",
        "Herramientas:",
        "forma_que_no_reconocemos",
      ]) {
        expect(hilo).not.toHaveTextContent(rastro);
      }
    },
  );

  it("un mensaje sin texto visible no deja burbuja: ni vacío ni con el JSON de una tool", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({}, [
            makeMessage({ id: "m1", content: "¿Qué autos tienen?" }),
            // Un turno que solo ejecutó tools.
            makeMessage({ ...BUSQUEDA, id: "m2", content: "  " }),
            // El resultado de una tool guardado como contenido.
            makeMessage({
              id: "m3",
              direction: "OUTBOUND",
              senderType: "AGENT",
              content: '[{"internalCode":"INT-0001","priceListUsd":12345}]',
            }),
            makeMessage({
              id: "m4",
              direction: "OUTBOUND",
              senderType: "AUTOMATION",
              content: '{"ok":true,"data":{}}',
            }),
          ]),
        ),
      ),
    );

    const { container } = renderDetail();

    expect(
      await screen.findByText("¿Qué autos tienen?", { selector: ".ds-chat-bubble" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".ds-chat-bubble")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-chat-item")).toHaveLength(1);
  });

  it("lo que escribe el cliente se muestra siempre, aunque parezca JSON", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({}, [makeMessage({ id: "m1", content: '{"hola":"che"}' })]),
        ),
      ),
    );

    renderDetail();

    expect(
      await screen.findByText('{"hola":"che"}', { selector: ".ds-chat-bubble" }),
    ).toBeInTheDocument();
  });

  it("el polling trae los mensajes nuevos sin borrar el borrador ni rearmar el hilo", async () => {
    let mensajes: ConversationMessage[] = [makeMessage({ id: "m1" })];
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, mensajes))));
    const user = userEvent.setup();
    const { queryClient } = renderDetail();

    const caja = await screen.findByLabelText("Mensaje para el cliente");
    await user.type(caja, "Hola Ana, te escribo por");
    const hiloAntes = screen.getByRole("list", { name: "Mensajes de la conversación" });

    mensajes = [...mensajes, makeMessage({ id: "m2", content: "¿Siguen ahí?" })];
    await queryClient.refetchQueries();

    expect(
      await screen.findByText("¿Siguen ahí?", { selector: ".ds-chat-bubble" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Mensaje para el cliente")).toHaveValue(
      "Hola Ana, te escribo por",
    );
    // El MISMO <ol>: un nodo nuevo volvería el scroll del hilo arriba de todo.
    expect(screen.getByRole("list", { name: "Mensajes de la conversación" })).toBe(hiloAntes);
  });

  it("un refetch que falla no tapa la conversación ni borra el borrador", async () => {
    let falla = false;
    server.use(
      http.get(detailUrl, () =>
        falla
          ? HttpResponse.json({ error: { message: "se cortó" } }, { status: 500 })
          : HttpResponse.json(makeConversationDetail({}, HILO)),
      ),
    );
    const user = userEvent.setup();
    const { queryClient } = renderDetail();

    const caja = await screen.findByLabelText("Mensaje para el cliente");
    await user.type(caja, "Borrador a medias");

    falla = true;
    await queryClient.refetchQueries();
    await waitFor(() =>
      expect(queryClient.getQueryState(["conversations", "detail", "conv-1"])?.status).toBe(
        "error",
      ),
    );

    expect(screen.queryByText(/No pudimos cargar la conversación/)).not.toBeInTheDocument();
    expect(screen.getByText("Hola Ana, sigo yo desde acá")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensaje para el cliente")).toHaveValue("Borrador a medias");
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

  it("I-03: debajo del hilo está el cuadro para responder por WhatsApp", async () => {
    server.use(http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))));

    renderDetail();
    await screen.findByText("Ana Pérez");

    expect(screen.getByRole("textbox", { name: "Mensaje para el cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("I-03: una respuesta de una persona que no salió muestra el motivo y se reintenta", async () => {
    const fallido = makeMessage({
      id: "m9",
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: "u1",
      senderUser: { id: "u1", fullName: "A" },
      content: "¿Te llegó?",
      deliveryStatus: "FAILED",
      deliveryError: "Recipient phone number not in allowed list",
      createdAt: "2026-03-03T10:05:00.000Z",
    });
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({ status: "TRANSFERRED_TO_HUMAN" }, [...HILO, fallido]),
        ),
      ),
    );
    let reintentado: string | null = null;
    server.use(
      http.post(`${detailUrl}/messages/:messageId/retry`, ({ params }) => {
        reintentado = String(params.messageId);
        return HttpResponse.json(
          makeConversationDetail({ status: "TRANSFERRED_TO_HUMAN" }, [
            ...HILO,
            { ...fallido, deliveryStatus: "SENT", deliveryError: null },
          ]),
        );
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    const burbuja = await screen.findByText("¿Te llegó?", { selector: ".ds-chat-bubble" });
    expect(
      within(burbuja).getByText(/No se pudo enviar: Recipient phone number not in allowed list/),
    ).toBeInTheDocument();

    await user.click(within(burbuja).getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(reintentado).toBe("m9"));
    await waitFor(() =>
      expect(
        within(screen.getByText("¿Te llegó?", { selector: ".ds-chat-bubble" })).queryByRole(
          "button",
          { name: "Reintentar" },
        ),
      ).toBeNull(),
    );
  });

  it("I-03: un vendedor que no atiende la conversación ve el fallo pero no el reintento", async () => {
    const fallido = makeMessage({
      id: "m9",
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: "u9",
      senderUser: { id: "u9", fullName: "Sofía Rodríguez" },
      content: "¿Te llegó?",
      deliveryStatus: "FAILED",
      deliveryError: "Error",
      createdAt: "2026-03-03T10:05:00.000Z",
    });
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          makeConversationDetail({ status: "TRANSFERRED_TO_HUMAN", assignedUserId: "u9" }, [
            ...HILO,
            fallido,
          ]),
        ),
      ),
    );

    renderDetail("USER");

    const burbuja = await screen.findByText("¿Te llegó?", { selector: ".ds-chat-bubble" });
    expect(within(burbuja).getByText(/No se pudo enviar/)).toBeInTheDocument();
    expect(within(burbuja).queryByRole("button", { name: "Reintentar" })).toBeNull();
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
    const textarea = screen.getByRole("textbox", { name: "Resumen de la conversación" });
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
    expect(
      screen.queryByRole("textbox", { name: "Resumen de la conversación" }),
    ).not.toBeInTheDocument();
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
    await user.clear(screen.getByRole("textbox", { name: "Resumen de la conversación" }));
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
    await user.clear(screen.getByRole("textbox", { name: "Resumen de la conversación" }));
    await user.type(
      screen.getByRole("textbox", { name: "Resumen de la conversación" }),
      "algo que no se guarda",
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(patches).toBe(0);
    expect(screen.getByText("Resumen viejo.")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Resumen de la conversación" }),
    ).not.toBeInTheDocument();
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
  // El cierre manual (ítem 168)
  // -------------------------------------------------------------------------

  it("'Cerrar conversación' confirma, llama al POST y deja la conversación Cerrada sin el botón", async () => {
    let cierres = 0;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))),
      http.post(`${detailUrl}/close`, () => {
        cierres += 1;
        return HttpResponse.json(makeConversationDetail({ status: "CLOSED" }, HILO));
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Cerrar conversación" }));

    expect(await screen.findByText("Cerrada")).toHaveClass("ds-badge");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cierres).toBe(1);
    expect(screen.queryByRole("button", { name: "Cerrar conversación" })).toBeNull();
    confirm.mockRestore();
  });

  it("cancelar la confirmación no llama al backend", async () => {
    let cierres = 0;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    server.use(
      http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))),
      http.post(`${detailUrl}/close`, () => {
        cierres += 1;
        return HttpResponse.json(makeConversationDetail({ status: "CLOSED" }, HILO));
      }),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Cerrar conversación" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cierres).toBe(0);
    expect(screen.getByText("Activa")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("una derivada a un humano también se puede cerrar, y un USER ve el botón", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ status: "TRANSFERRED_TO_HUMAN" }, HILO)),
      ),
    );

    renderDetail("USER");

    expect(await screen.findByRole("button", { name: "Cerrar conversación" })).toBeInTheDocument();
  });

  it("una conversación ya cerrada no ofrece cerrarla", async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(makeConversationDetail({ status: "CLOSED" }, HILO)),
      ),
    );

    renderDetail();

    expect(await screen.findByText("Cerrada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar conversación" })).toBeNull();
  });

  it("si cerrar falla, muestra el error y la conversación sigue abierta", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    server.use(
      http.get(detailUrl, () => HttpResponse.json(makeConversationDetail({}, HILO))),
      http.post(`${detailUrl}/close`, () =>
        HttpResponse.json({ error: { message: "Conversación no encontrada" } }, { status: 404 }),
      ),
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Cerrar conversación" }));

    expect(await screen.findByText(/No pudimos cerrar la conversación/)).toHaveTextContent(
      "Conversación no encontrada",
    );
    expect(screen.getByText("Activa")).toBeInTheDocument();
    confirm.mockRestore();
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
