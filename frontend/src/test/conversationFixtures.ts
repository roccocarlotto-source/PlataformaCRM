import type {
  Conversation,
  ConversationDetail,
  ConversationMessage,
} from "../features/conversation/types";

// Fixtures compartidas entre los tests de features/conversation/ (bandeja y
// detalle). Los valores por defecto son los de una conversación normal del
// canal WhatsApp: activa, con contacto, agente y sucursal ya resueltos por el
// backend (conversationInclude).

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    organizationId: "org-1",
    branchId: "branch-1",
    agentId: "agent-1",
    contactId: "contact-1",
    assignedUserId: null,
    channel: "WHATSAPP",
    status: "ACTIVE",
    externalThreadId: null,
    lastMessageAt: "2026-03-03T10:00:00.000Z",
    // Sin brief por defecto (ítem 73): es el estado de toda conversación que
    // nunca se derivó ni pasó por el botón, y el que hace que el caso vacío
    // sea el que un test tiene que montar a propósito y no al revés.
    brief: null,
    briefEditedByUserId: null,
    createdAt: "2026-03-03T09:00:00.000Z",
    updatedAt: "2026-03-03T10:00:00.000Z",
    contact: { id: "contact-1", firstName: "Ana", lastName: "Pérez" },
    agent: { id: "agent-1", name: "Vera" },
    branch: { id: "branch-1", name: "Centro" },
    ...overrides,
  };
}

// Un mensaje del contacto. Los otros dos autores se arman con overrides
// —senderType + direction + senderUser— para que cada test diga en su propio
// cuerpo qué está montando.
export function makeMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "msg-1",
    organizationId: "org-1",
    conversationId: "conv-1",
    direction: "INBOUND",
    senderType: "CONTACT",
    senderUserId: null,
    content: "Hola, quiero saber el precio",
    toolCalls: null,
    externalMessageId: null,
    createdAt: "2026-03-03T09:58:00.000Z",
    senderUser: null,
    ...overrides,
  };
}

// `briefEditedBy` solo existe en el DETALLE: el listado no lo trae porque no
// lo muestra (ver findConversationWithMessages en el repositorio). null es lo
// normal — un brief redactado por la IA no tiene editor.
export function makeConversationDetail(
  overrides: Partial<ConversationDetail> = {},
  messages: ConversationMessage[] = [makeMessage()],
): ConversationDetail {
  return { ...makeConversation(), messages, briefEditedBy: null, ...overrides };
}
