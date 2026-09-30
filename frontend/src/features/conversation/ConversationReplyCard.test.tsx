import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeConversationDetail } from "../../test/conversationFixtures";
import type { AuthContextValue } from "../../auth/AuthContext";
import { AVISO_VENTANA_VENCIDA, ConversationReplyCard } from "./ConversationReplyCard";
import type { ConversationDetail } from "./types";

// Responder desde el CRM (I-03 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local). La tarjeta sola,
// con el backend doblado por msw: qué se muestra en cada caso y qué se manda.

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER", id = "u1"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id,
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

const baseUrl = `${env.apiUrl}/api/conversations/conv-1`;
const AHORA = Date.parse("2026-09-30T12:00:00.000Z");

function renderCard(
  conversation: ConversationDetail,
  role: "ADMIN" | "USER" = "ADMIN",
  userId = "u1",
) {
  useAuthMock.mockReturnValue(mockAuth(role, userId));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationReplyCard conversation={conversation} ahora={() => AHORA} />
    </QueryClientProvider>,
  );
}

const ABIERTA = { replyWindowEndsAt: "2026-09-30T20:00:00.000Z" };

describe("ConversationReplyCard", () => {
  it("un ADMIN escribe y envía: manda el texto y vacía el cuadro", async () => {
    let recibido: unknown = null;
    server.use(
      http.post(`${baseUrl}/messages`, async ({ request }) => {
        recibido = await request.json();
        return HttpResponse.json(
          makeConversationDetail({ ...ABIERTA, status: "TRANSFERRED_TO_HUMAN", agentPaused: true }),
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderCard(makeConversationDetail(ABIERTA));

    const cuadro = screen.getByRole("textbox", { name: "Mensaje para el cliente" });
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await user.type(cuadro, "Hola, soy de la concesionaria");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(recibido).toEqual({ text: "Hola, soy de la concesionaria" }));
    await waitFor(() => expect(cuadro).toHaveValue(""));
  });

  it("dice que sale por WhatsApp y hasta cuándo se puede escribir", () => {
    renderCard(makeConversationDetail(ABIERTA));
    expect(screen.getByText(/Sale por WhatsApp desde el número del negocio/)).toBeInTheDocument();
    expect(screen.getByText(/el agente no responde/)).toBeInTheDocument();
  });

  it("pasadas las 24 h, el cuadro queda deshabilitado con la explicación", () => {
    renderCard(makeConversationDetail({ replyWindowEndsAt: "2026-09-30T11:00:00.000Z" }));
    expect(screen.getByRole("textbox", { name: "Mensaje para el cliente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    expect(screen.getByText(AVISO_VENTANA_VENCIDA)).toBeInTheDocument();
  });

  it("si el cliente nunca escribió, tampoco se puede (sin ventana)", () => {
    renderCard(makeConversationDetail({ replyWindowEndsAt: null }));
    expect(screen.getByRole("textbox", { name: "Mensaje para el cliente" })).toBeDisabled();
    expect(screen.getByText(AVISO_VENTANA_VENCIDA)).toBeInTheDocument();
  });

  it("una conversación del chat web explica que solo se responde por WhatsApp", () => {
    renderCard(makeConversationDetail({ ...ABIERTA, channel: "WEB" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    expect(
      screen.getByText(/solo se puede responder desde el CRM en conversaciones de WhatsApp/),
    ).toBeInTheDocument();
  });

  it("un vendedor que no tiene asignada la conversación no puede responder", () => {
    renderCard(makeConversationDetail({ ...ABIERTA, assignedUserId: "otro" }), "USER");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Solo el vendedor asignado/)).toBeInTheDocument();
  });

  it("el vendedor asignado sí puede responder", () => {
    renderCard(makeConversationDetail({ ...ABIERTA, assignedUserId: "u1" }), "USER", "u1");
    expect(screen.getByRole("textbox", { name: "Mensaje para el cliente" })).toBeEnabled();
  });

  it("una cerrada no muestra la tarjeta", () => {
    const { container } = renderCard(makeConversationDetail({ ...ABIERTA, status: "CLOSED" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("con el agente en pausa lo dice, y 'Devolver al agente' lo reactiva", async () => {
    let devuelta = false;
    server.use(
      http.post(`${baseUrl}/return-to-agent`, () => {
        devuelta = true;
        return HttpResponse.json(makeConversationDetail({ ...ABIERTA, status: "ACTIVE" }));
      }),
    );
    const user = userEvent.setup();
    renderCard(
      makeConversationDetail({ ...ABIERTA, status: "TRANSFERRED_TO_HUMAN", agentPaused: true }),
    );

    expect(screen.getByText(/El agente está en pausa/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Devolver al agente" }));
    await waitFor(() => expect(devuelta).toBe(true));
  });

  it("'Devolver al agente' no aparece si la conversación no está derivada", () => {
    renderCard(makeConversationDetail({ ...ABIERTA, status: "ACTIVE" }));
    expect(screen.queryByRole("button", { name: "Devolver al agente" })).toBeNull();
  });

  it("si el backend rechaza el envío, muestra el motivo y conserva lo escrito", async () => {
    server.use(
      http.post(`${baseUrl}/messages`, () =>
        HttpResponse.json(
          { error: { message: "Pasaron más de 24 h desde el último mensaje del cliente" } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderCard(makeConversationDetail(ABIERTA));

    const cuadro = screen.getByRole("textbox", { name: "Mensaje para el cliente" });
    await user.type(cuadro, "Hola");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText(/No se pudo enviar: Pasaron más de 24 h/)).toBeInTheDocument();
    expect(cuadro).toHaveValue("Hola");
  });
});
