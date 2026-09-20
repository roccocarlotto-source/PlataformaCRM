import {
  countConversations,
  findConversationWithMessages,
  findManyConversations,
  type ConversationFilters,
  type ConversationSortBy,
  type SortOrder,
} from "../repositories/conversation.repository";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Bandeja de conversaciones (ítem 66 de docs/frontend-cambios-pendientes.md):
// la lectura de las conversaciones que el módulo de Agentes de IA ya venía
// escribiendo (docs/ai-agent-architecture.md §3). Mismo molde exacto que
// automation.service.ts / knowledgeBaseEntry.service.ts: scopeado por
// organizationId en cada operación, paginación con la misma forma de
// respuesta, 404 con AppError.
//
// LO QUE NO HAY ACÁ, Y NO ES UN OLVIDO: ninguna escritura. No hay crear, no
// hay editar, no hay cerrar, y sobre todo no hay responder. Un mensaje
// saliente no es una fila más en `messages`: hay que ENTREGARLO por el canal
// (el widget web no tiene forma de recibir un mensaje que no sea la respuesta
// al suyo; WhatsApp todavía no existe, es el paso 6 de §9). Guardar un Message
// OUTBOUND que nadie entrega sería mostrarle a un vendedor que contestó cuando
// el contacto no recibió nada. Por eso esta capa es de solo lectura entera, y
// lo va a seguir siendo hasta que exista la entrega.
//
// LA OTRA COSA QUE NO HAY: aislamiento por usuario. A diferencia de
// activity.service.ts —que acota a un USER a lo que tiene asignado (ítem
// 25)—, acá cualquier usuario autenticado de la organización ve todas las
// conversaciones. Una conversación no tiene dueño mientras el agente la
// atiende (assignedUserId se completa recién en el handoff, y puede quedar en
// NULL si el contacto no tenía vendedor), así que filtrar por usuario dejaría
// la bandeja vacía justo en el caso normal.
// ---------------------------------------------------------------------------

export interface ListConversationsParams {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  agentId?: string;
  contactId?: string;
  status?: ConversationFilters["status"];
  channel?: ConversationFilters["channel"];
  sortBy: ConversationSortBy;
  sortOrder: SortOrder;
}

export async function listConversations(organizationId: string, params: ListConversationsParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyConversations(
      organizationId,
      filters as ConversationFilters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countConversations(organizationId, filters as ConversationFilters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

// 404 y no 403 cuando la conversación es de otra organización, mismo criterio
// que todo el resto del CRUD: el WHERE ya lleva organizationId, así que la
// fila simplemente no existe para quien pregunta — y responder 403 confirmaría
// que ese id existe en algún lado.
export async function getConversationById(organizationId: string, id: string) {
  const conversation = await findConversationWithMessages(id, organizationId);
  if (!conversation) {
    throw new AppError("Conversación no encontrada", 404);
  }
  return conversation;
}
