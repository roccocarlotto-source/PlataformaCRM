import type { ConversationChannel, ConversationStatus } from "../agent/types";

// Reconstruido desde el contrato real del backend
// (src/controllers/conversation.controller.ts,
// src/services/conversation.service.ts,
// src/repositories/conversation.repository.ts, prisma/schema.prisma modelos
// Conversation y Message). Ítem 66 de docs/frontend-cambios-pendientes.md;
// diseño del módulo en docs/ai-agent-architecture.md §3.
//
// No se declara ningún campo que el backend no devuelva: cada uno de los de
// abajo está verificado contra el modelo y contra el `include` del
// repositorio.
//
// ConversationChannel y ConversationStatus se REUSAN de features/agent/types:
// son los mismos dos enums de Prisma y ya estaban espejados ahí (el probador
// del ítem 65 devuelve el status del turno). Un segundo espejo que se pueda
// desincronizar del primero no aporta nada.
export type { ConversationChannel, ConversationStatus };

// Espejo del enum MessageDirection. Ortogonal a senderType a propósito, igual
// que en el schema: la dirección dice por dónde viajó el mensaje, el tipo de
// emisor dice quién lo escribió.
export type MessageDirection = "INBOUND" | "OUTBOUND";

// Espejo del enum MessageSenderType. HUMAN es una persona de la organización
// que contestó después de una derivación, y es el único que trae senderUser
// (lo garantiza el CHECK messages_sender_user_id_consistency_check).
export type MessageSenderType = "CONTACT" | "AGENT" | "HUMAN";

// Las tres relaciones que el backend resuelve por nombre en la misma consulta
// (conversationInclude), para que la tabla no tenga que resolver un contacto
// por fila. Solo campos de exhibición: los ids ya viajan en la fila.
export interface ConversationContactRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ConversationAgentRef {
  id: string;
  name: string;
}

export interface ConversationBranchRef {
  id: string;
  name: string;
}

export interface Conversation {
  id: string;
  organizationId: string;
  branchId: string;
  agentId: string;
  contactId: string;
  // Se completa solo en una derivación, y puede quedar en null incluso ahí
  // (el contacto no tenía vendedor asignado). Ver el modelo.
  assignedUserId: string | null;
  channel: ConversationChannel;
  status: ConversationStatus;
  // Id del hilo en el canal externo. Dato de diagnóstico, no de pantalla.
  externalThreadId: string | null;
  // null mientras no haya ni un mensaje. El listado los ordena al final.
  lastMessageAt: string | null;
  // El resumen de la conversación (ítem 73). null mientras nunca se generó —
  // que es el estado de toda conversación anterior al ítem. Lo redacta la IA
  // (al derivar a una persona, o a pedido desde la pantalla) y se puede
  // corregir a mano.
  brief: string | null;
  // Quién escribió el TEXTO que hoy está en `brief`, no quién apretó el botón:
  // null cuando lo redactó la IA —aunque la generación la haya disparado una
  // persona— y con valor solo cuando alguien lo editó a mano. Es lo que dibuja
  // la marca "Editado a mano". Ver el modelo en prisma/schema.prisma.
  briefEditedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  contact: ConversationContactRef;
  agent: ConversationAgentRef;
  branch: ConversationBranchRef;
}

// `toolCalls` es Json? en la base y NADIE le impone una forma: lo escribe
// runAgentTurn con la forma de ToolCallDelTurno, pero eso es una convención
// del código, no una restricción de Postgres ni un schema de Zod. Por eso acá
// es `unknown` y no TestMessageToolCall[] — tiparlo como si estuviera
// garantizado sería prometer algo que no es cierto. Quien lo muestra lo
// estrecha con parseToolCalls y cae en JSON crudo si no reconoce la forma,
// mismo criterio que Agent.guardrails con Record<string, unknown>.
export interface ConversationMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderUserId: string | null;
  content: string;
  toolCalls: unknown;
  externalMessageId: string | null;
  createdAt: string;
  // Solo en los mensajes HUMAN; null en los del contacto y los del agente.
  senderUser: { id: string; fullName: string } | null;
}

// Lo que devuelve GET /api/conversations/:id: la conversación con el hilo
// COMPLETO, sin paginar (ver findConversationWithMessages). Es también lo que
// devuelven el PATCH y el POST del brief, para que la pantalla pueda guardar
// la respuesta en la cache sin volver a pedir nada.
export interface ConversationDetail extends Conversation {
  messages: ConversationMessage[];
  // Quién corrigió el brief a mano, resuelto por nombre. null cuando lo
  // redactó la IA. Solo viaja en el DETALLE: el listado no lo trae, porque no
  // lo muestra (ver findConversationWithMessages en el repositorio).
  briefEditedBy: { id: string; fullName: string } | null;
}

export interface ConversationListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ConversationListResponse {
  data: Conversation[];
  pagination: ConversationListPagination;
}

export type ConversationSortBy = "lastMessageAt" | "createdAt";
export type SortOrder = "asc" | "desc";

// listQuerySchema del controller. `search` busca por el CONTACTO (nombre,
// apellido o email), no dentro de los mensajes — ver el comentario de
// buildWhere en src/repositories/conversation.repository.ts.
export interface ConversationListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  branchId?: string;
  agentId?: string;
  contactId?: string;
  status?: ConversationStatus;
  channel?: ConversationChannel;
  sortBy?: ConversationSortBy;
  sortOrder?: SortOrder;
}
