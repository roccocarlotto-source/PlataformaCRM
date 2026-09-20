import type { ConversationChannel, ConversationStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// Conversaciones del módulo de Agentes de IA. Mismo patrón que
// agent.repository.ts: organizationId obligatorio en cada lectura y escritura.
// Conversation NO tiene deletedAt —es historial, no configuración—, así que acá
// no hay filtro de soft delete.

// La conversación ABIERTA de un contacto con un agente por un canal: ACTIVE o
// TRANSFERRED_TO_HUMAN. Una derivada sigue siendo "la" conversación de ese
// contacto —lo que llega después va ahí, para que el humano que la tomó vea
// el hilo entero— aunque el agente ya no la responda. Solo una CLOSED deja de
// contar y da lugar a una nueva. Ver runAgentTurn.
export function findOpenConversation(
  organizationId: string,
  agentId: string,
  contactId: string,
  channel: ConversationChannel,
  db: Db = prisma,
) {
  return db.conversation.findFirst({
    where: {
      organizationId,
      agentId,
      contactId,
      channel,
      status: { in: ["ACTIVE", "TRANSFERRED_TO_HUMAN"] },
    },
    // Si por alguna razón hubiera más de una, la más reciente.
    orderBy: { createdAt: "desc" },
  });
}

export function findConversationById(id: string, organizationId: string, db: Db = prisma) {
  return db.conversation.findFirst({ where: { id, organizationId } });
}

export interface CreateConversationData {
  organizationId: string;
  branchId: string;
  agentId: string;
  contactId: string;
  channel: ConversationChannel;
  externalThreadId?: string;
}

export function createConversation(data: CreateConversationData, db: Db = prisma) {
  return db.conversation.create({ data });
}

export interface UpdateConversationData {
  status?: ConversationStatus;
  lastMessageAt?: Date;
  assignedUserId?: string | null;
  // Ítem 73. Los dos SIEMPRE juntos en cada escritura, y es la invariante de
  // la feature: `briefEditedByUserId` describe quién escribió el texto que
  // quedó en `brief`, así que dejar uno sin el otro los desincroniza — un
  // brief nuevo de la IA con el editor de la versión anterior todavía puesto.
  // Los dos únicos llamadores lo respetan: generarBriefDeConversacion manda
  // `null` en el editor, y el PATCH manda el usuario autenticado.
  brief?: string | null;
  briefEditedByUserId?: string | null;
}

// updateMany: el WHERE exige organizationId además de id (M4).
export function updateConversation(
  id: string,
  organizationId: string,
  data: UpdateConversationData,
  db: Db = prisma,
) {
  return db.conversation.updateMany({ where: { id, organizationId }, data });
}

// La conversación MÁS RECIENTE de un agente por un canal con ese id de hilo
// externo (para el canal Web: el sessionId del navegador). SIN filtro de
// status, a diferencia de findOpenConversation: lo que se busca acá es el
// Contact de esa sesión, y tiene que encontrarse aunque la conversación
// previa ya esté CLOSED — quien decide si hace falta una Conversation nueva es
// findOpenConversation, que runAgentTurn llama después con el contactId ya
// resuelto. Ver widgetContact.service.ts.
export function findConversationByExternalThreadId(
  organizationId: string,
  agentId: string,
  channel: ConversationChannel,
  externalThreadId: string,
  db: Db = prisma,
) {
  return db.conversation.findFirst({
    where: { organizationId, agentId, channel, externalThreadId },
    select: { id: true, contactId: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Bandeja de conversaciones (ítem 66 de docs/frontend-cambios-pendientes.md).
// Lo de arriba es lo que el loop del agente necesita para ESCRIBIR una
// conversación; lo de acá abajo es lo único que hace falta para LEERLA desde
// el CRM: un listado paginado y el hilo completo de una. No hay una sola
// escritura nueva en este bloque, y eso es el ítem entero.
// ---------------------------------------------------------------------------

export interface ConversationFilters {
  // Por CONTACTO, no por el contenido de los mensajes. Ver el comentario de
  // buildWhere.
  search?: string;
  branchId?: string;
  agentId?: string;
  contactId?: string;
  status?: ConversationStatus;
  channel?: ConversationChannel;
}

export type ConversationSortBy = "lastMessageAt" | "createdAt";
export type SortOrder = "asc" | "desc";

// Lo que la bandeja muestra de cada conversación además de sus propias
// columnas: con quién es, qué agente la atiende y de qué sucursal. Solo
// campos de exhibición —nombre y nada más—, mismo criterio que quoteInclude.
// El id de cada relación viaja igual en la fila (contactId, agentId,
// branchId), así que acá no se repite.
export const conversationInclude = {
  contact: { select: { id: true, firstName: true, lastName: true } },
  agent: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} satisfies Prisma.ConversationInclude;

// El único lugar donde se arma el filtro multi-tenant de esta lectura, para
// que findMany/count nunca puedan divergir. SIN deletedAt: Conversation no
// tiene soft delete —"cerrada" es un status, ver el comentario del modelo—,
// así que acá no hay nada que filtrar por ese lado.
//
// `search` es por el CONTACTO (nombre, apellido o email), no por el contenido
// de los mensajes, y es una decisión: buscar adentro del texto de un hilo es
// un ILIKE '%x%' sobre un Text sin índice trigrama en una tabla que crece un
// registro por mensaje, y además devolvería conversaciones cuyo motivo de
// coincidencia no se ve en ninguna columna del listado. Lo que alguien
// realmente busca en una bandeja es "la conversación con Fulano". Buscar
// adentro del hilo es búsqueda de verdad, no un `contains` más.
function buildWhere(
  organizationId: string,
  filters: ConversationFilters,
): Prisma.ConversationWhereInput {
  return {
    organizationId,
    ...(filters.search
      ? {
          // `is` y no un objeto pelado: contactId es NOT NULL, así que la
          // relación siempre existe y esto es un filtro sobre la fila
          // relacionada, no sobre su ausencia.
          contact: {
            is: {
              OR: [
                { firstName: { contains: filters.search, mode: "insensitive" } },
                { lastName: { contains: filters.search, mode: "insensitive" } },
                { email: { contains: filters.search, mode: "insensitive" } },
              ],
            },
          },
        }
      : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
  };
}

// SIEMPRE con `id` de desempate, y no es cosmético: sin un segundo criterio,
// dos filas con el mismo lastMessageAt (o las dos en NULL, que es el caso
// común de una conversación sin mensajes todavía) pueden salir en orden
// distinto en dos consultas seguidas, y la página 2 repetiría o saltearía
// filas que la 1 ya mostró. Es exactamente el bug abierto de
// qrCode.repository.ts, que acá no se repite.
//
// `nulls: "last"` en lastMessageAt: una conversación sin mensajes no es lo
// más reciente de la bandeja, y el default de Postgres para DESC la pondría
// primera.
function buildOrderBy(
  sortBy: ConversationSortBy,
  sortOrder: SortOrder,
): Prisma.ConversationOrderByWithRelationInput[] {
  switch (sortBy) {
    case "createdAt":
      return [{ createdAt: sortOrder }, { id: sortOrder }];
    case "lastMessageAt":
    default:
      return [{ lastMessageAt: { sort: sortOrder, nulls: "last" } }, { id: sortOrder }];
  }
}

export function findManyConversations(
  organizationId: string,
  filters: ConversationFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: ConversationSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.conversation.findMany({
    where: buildWhere(organizationId, filters),
    include: conversationInclude,
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countConversations(
  organizationId: string,
  filters: ConversationFilters,
  db: Db = prisma,
) {
  return db.conversation.count({ where: buildWhere(organizationId, filters) });
}

// El hilo completo, en UNA consulta: la conversación con sus relaciones de
// exhibición y todos sus mensajes en orden cronológico.
//
// SIN paginar los mensajes, a diferencia del listado. El índice
// (conversation_id, created_at) sirve esta lectura tal cual, y un hilo
// mochado por la mitad no cumpliría lo único que esta pantalla promete: ver
// todo lo que pasó. Si algún día un hilo de miles de mensajes lo justifica,
// paginar acá es agregar skip/take y una pantalla que sepa pedir la página
// siguiente — no rehacer nada de lo que hay.
//
// `senderUser` solo tiene valor en los mensajes HUMAN (el CHECK
// messages_sender_user_id_consistency_check lo exige ahí y lo prohíbe en el
// resto), y es lo que deja que el hilo diga QUIÉN de la organización
// contestó después de una derivación, en vez de un "un humano" anónimo.
//
// `briefEditedBy` se resuelve ACÁ Y NO en conversationInclude (ítem 73), a
// diferencia de contact/agent/branch: el nombre de quien corrigió el resumen
// solo se muestra en el detalle, y meterlo en el include compartido le
// agregaría un join por fila al listado para un dato que esa pantalla no
// dibuja. El listado muestra el brief truncado, que ya viaja en la propia
// columna.
export function findConversationWithMessages(id: string, organizationId: string, db: Db = prisma) {
  return db.conversation.findFirst({
    where: { id, organizationId },
    include: {
      ...conversationInclude,
      briefEditedBy: { select: { id: true, fullName: true } },
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { senderUser: { select: { id: true, fullName: true } } },
      },
    },
  });
}
