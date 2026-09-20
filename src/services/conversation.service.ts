import {
  countConversations,
  findConversationWithMessages,
  findManyConversations,
  updateConversation,
  type ConversationFilters,
  type ConversationSortBy,
  type SortOrder,
} from "../repositories/conversation.repository";
import { AppError } from "../utils/AppError";
import { generarBriefDeConversacion } from "./conversationBrief.service";

// ---------------------------------------------------------------------------
// Bandeja de conversaciones (ítem 66 de docs/frontend-cambios-pendientes.md):
// la lectura de las conversaciones que el módulo de Agentes de IA ya venía
// escribiendo (docs/ai-agent-architecture.md §3). Mismo molde exacto que
// automation.service.ts / knowledgeBaseEntry.service.ts: scopeado por
// organizationId en cada operación, paginación con la misma forma de
// respuesta, 404 con AppError.
//
// LO QUE SIGUE SIN HABER, Y NO ES UN OLVIDO: no hay crear, no hay cerrar, y
// sobre todo NO HAY RESPONDER. Un mensaje saliente no es una fila más en
// `messages`: hay que ENTREGARLO por el canal (el widget web no tiene forma de
// recibir un mensaje que no sea la respuesta al suyo; WhatsApp todavía no
// existe, es el paso 6 de §9). Guardar un Message OUTBOUND que nadie entrega
// sería mostrarle a un vendedor que contestó cuando el contacto no recibió
// nada. Eso sigue afuera hasta que exista la entrega.
//
// LAS DOS ÚNICAS ESCRITURAS son las del brief (ítem 73), y no contradicen
// nada de lo anterior: el brief es una anotación INTERNA sobre la
// conversación, no un mensaje. No viaja a ningún lado, no lo ve el contacto y
// no se entrega por ningún canal — vive en dos columnas de `conversations` y
// se lee desde el CRM. La barrera que este módulo cuida es "no escribir en
// `messages`", y sigue intacta: acá no se crea ni un solo Message.
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

// ---------------------------------------------------------------------------
// El brief (ítem 73). Las dos operaciones devuelven la conversación ENTERA con
// su hilo, y no solo el brief: es la misma forma que ya devuelve el GET del
// detalle, así que la pantalla puede meter la respuesta en la cache de
// react-query sin una segunda lectura ni un merge a mano.
//
// LAS DOS EMPIEZAN POR getConversationById, y no es una lectura de más: es lo
// que hace que una conversación de otra organización —o un id inexistente— sea
// 404 ANTES de escribir nada o de gastar una llamada al proveedor de LLM. Un
// updateMany con organizationId en el WHERE también aislaría, pero devolvería
// `{ count: 0 }` en silencio y habría que traducirlo igual; acá el 404 sale de
// un solo lugar para las tres operaciones.
// ---------------------------------------------------------------------------

// La edición A MANO. Es la única operación que completa briefEditedByUserId,
// porque es la única en la que el texto lo escribió una persona.
//
// `null` vacía el brief y lo devuelve al estado "todavía no se generó", con la
// pantalla ofreciendo generarlo de nuevo. Se vacían LOS DOS campos: un editor
// registrado sobre un brief inexistente no querría decir nada.
export async function updateConversationBrief(
  organizationId: string,
  id: string,
  userId: string,
  brief: string | null,
) {
  await getConversationById(organizationId, id);

  const texto = brief?.trim() ? brief.trim() : null;
  await updateConversation(id, organizationId, {
    brief: texto,
    briefEditedByUserId: texto === null ? null : userId,
  });

  return getConversationById(organizationId, id);
}

// La generación A PEDIDO desde la pantalla. A diferencia del disparador
// automático dentro de ejecutarHandoff, acá el error SÍ sube: no hay ningún
// handoff que proteger, es una acción explícita de una persona que apretó un
// botón, y tiene que poder ver que falló en vez de quedarse mirando un brief
// que no cambió. El errorHandler traduce solo: LlmProviderError ya es 502 y el
// proveedor sin configurar ya es 500.
export async function generateConversationBrief(organizationId: string, id: string) {
  await getConversationById(organizationId, id);
  await generarBriefDeConversacion(organizationId, id);
  return getConversationById(organizationId, id);
}
