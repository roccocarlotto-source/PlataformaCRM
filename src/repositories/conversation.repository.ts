import { Prisma, type ConversationChannel, type ConversationStatus } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// Conversaciones del módulo de Agentes de IA. Mismo patrón que
// agent.repository.ts: organizationId obligatorio en cada lectura y escritura.
// Conversation NO tiene deletedAt —es historial, no configuración—, así que acá
// no hay filtro de soft delete.

// La conversación ABIERTA de un contacto con un agente por un canal: ACTIVE o
// TRANSFERRED_TO_HUMAN. Una derivada sigue siendo "la" conversación de ese
// contacto —lo que llega después va ahí, para que el humano que la tomó vea
// el hilo entero— y desde el ítem 83 el agente además la sigue respondiendo
// hasta que esa persona escriba. Solo una CLOSED deja de contar y da lugar a
// una nueva. Ver el gate de runAgentTurn.
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

// La conversación MÁS RECIENTE de un contacto, con cualquier agente, canal y
// estado (ítem 76): el borrador de seguimiento de una oportunidad estancada
// usa su transcript como contexto. "Más reciente" por el último mensaje, que es
// lo que mide cuándo se habló por última vez; una conversación sin mensajes
// (lastMessageAt NULL) va al final, y el id desempata para que el resultado no
// dependa del plan de ejecución.
export function findLatestConversationByContact(
  organizationId: string,
  contactId: string,
  db: Db = prisma,
) {
  return db.conversation.findFirst({
    where: { organizationId, contactId },
    orderBy: [
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ],
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

// La conversación abierta del contacto con el agente por el canal, creándola
// si no hay (ítem 126 de docs/auditoria-2026-09-24-punta-a-punta.md, B-03 y
// C-01). Es el único camino por el que el código abre una conversación.
//
// LA GARANTÍA ES DE LA BASE, NO DE ESTA FUNCIÓN: el índice único parcial
// conversations_open_unique (migración 20260930120000) admite a lo sumo una
// abierta por (organización, agente, contacto, canal). Dos llamadas en
// paralelo pueden ver las dos "no hay" y las dos intentar el INSERT; el
// segundo choca con P2002 y acá se relee la que ganó, en vez de fallar. Antes
// del índice, los dos INSERT pasaban y quedaban dos abiertas: una con el hilo
// y otra vacía, y el próximo mensaje caía en la vacía (el modelo perdía el
// historial).
//
// SIN el `db` de una transacción a propósito: un P2002 dentro de una
// transacción de Postgres la deja abortada, y el releer de abajo fallaría
// ("current transaction is aborted"). Cada paso va suelto.
export async function findOrCreateOpenConversation(data: CreateConversationData) {
  const { organizationId, agentId, contactId, channel } = data;
  const existente = await findOpenConversation(organizationId, agentId, contactId, channel);
  if (existente) {
    return existente;
  }
  try {
    return await createConversation(data);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ganadora = await findOpenConversation(organizationId, agentId, contactId, channel);
      if (ganadora) {
        return ganadora;
      }
    }
    throw err;
  }
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

// La derivación a humano como compare-and-swap (ítem 126, C-05): pasa a
// TRANSFERRED_TO_HUMAN solo si estaba ACTIVE. count 1 = esta llamada hizo la
// transición y le toca avisar; 0 = ya estaba derivada (o la ganó otra llamada
// concurrente), o se CERRÓ. Ver ejecutarHandoff.
//
// "ACTIVE" y no "distinto de TRANSFERRED_TO_HUMAN" — B-16 de
// docs-privados/auditoria-2026-09-30-corta.md (local): con el WHERE anterior,
// el turno en curso de una conversación que un vendedor acababa de cerrar la
// reabría en silencio, o chocaba con conversations_open_unique si el contacto
// ya tenía otra abierta (P2002 → el worker repetía el turno entero hasta
// FAILED).
export function transferConversationToHuman(
  id: string,
  organizationId: string,
  assignedUserId: string | null,
  db: Db = prisma,
) {
  return db.conversation.updateMany({
    where: { id, organizationId, status: "ACTIVE" },
    data: { status: "TRANSFERRED_TO_HUMAN", assignedUserId },
  });
}

// Una persona contesta desde el CRM (I-03 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): la conversación
// queda TRANSFERRED_TO_HUMAN —es lo que, junto con su mensaje HUMAN, calla al
// agente— y, si nadie la tenía asignada, pasa a ser de quien contestó. Una ya
// asignada conserva su vendedor: que un ADMIN conteste no se la quita.
//
// Solo sobre una abierta: una CLOSED no se reabre desde acá (el service ya lo
// rechaza antes; esto es la garantía si la cerraron en el medio). count 0 =
// estaba cerrada.
export async function takeOverConversation(
  id: string,
  organizationId: string,
  userId: string,
  lastMessageAt: Date,
  db: Db = prisma,
) {
  const abierta = { id, organizationId, status: { not: "CLOSED" as const } };
  const tomada = await db.conversation.updateMany({
    where: { ...abierta, assignedUserId: null },
    data: { status: "TRANSFERRED_TO_HUMAN", assignedUserId: userId, lastMessageAt },
  });
  if (tomada.count === 1) {
    return tomada;
  }
  return db.conversation.updateMany({
    where: abierta,
    data: { status: "TRANSFERRED_TO_HUMAN", lastMessageAt },
  });
}

// "Devolver al agente" (I-03): de TRANSFERRED_TO_HUMAN a ACTIVE, y nada más.
// Con eso humanoAtiendeLaConversacion da false y el próximo mensaje del
// contacto lo contesta el agente; si el agente vuelve a derivar, el CAS de
// transferConversationToHuman vuelve a avisar. assignedUserId se conserva: el
// contacto sigue teniendo el mismo vendedor. count 0 = no estaba derivada (ya
// era ACTIVE, o está CLOSED).
export function returnConversationToAgent(id: string, organizationId: string, db: Db = prisma) {
  return db.conversation.updateMany({
    where: { id, organizationId, status: "TRANSFERRED_TO_HUMAN" },
    data: { status: "ACTIVE" },
  });
}

// El cierre manual desde la bandeja (ítem 168), como compare-and-swap, mismo
// molde que transferConversationToHuman: pasa a CLOSED solo si no lo estaba.
// count 0 NO es un error — la conversación ya estaba cerrada (o la cerró otra
// llamada concurrente), y cerrar dos veces deja exactamente el mismo estado.
//
// Cerrarla la saca del índice único conversations_open_unique, así que el
// próximo mensaje del mismo contacto por el mismo canal abre una conversación
// NUEVA (ver findOrCreateOpenConversation). Es lo esperado, no una regresión.
export function closeConversation(id: string, organizationId: string, db: Db = prisma) {
  return db.conversation.updateMany({
    where: { id, organizationId, status: { not: "CLOSED" } },
    data: { status: "CLOSED" },
  });
}

// Conversaciones ABIERTAS (ACTIVE o TRANSFERRED_TO_HUMAN) de una sucursal o de
// un contacto — los conteos de los RESTRICT de deleteBranch y deleteContact
// (ítem 167, C-03/C-04 de la auditoría, reactivado en el ítem 168 cuando
// existió cómo cerrarlas). Mismo criterio de "abierta" que
// findOpenConversation. organizationId en el WHERE por el mismo motivo que
// countConfirmedBookingsOf.
export function countOpenConversationsOf(
  where: { branchId: string } | { contactId: string },
  organizationId: string,
  db: Db = prisma,
) {
  return db.conversation.count({
    where: { ...where, organizationId, status: { in: ["ACTIVE", "TRANSFERRED_TO_HUMAN"] } },
  });
}

// La conversación MÁS RECIENTE de un agente por un canal con ese id de hilo
// externo (para el canal Web: el sessionId del navegador). SIN filtro de
// status, a diferencia de findOpenConversation: lo que se busca acá es el
// Contact de esa sesión, y tiene que encontrarse aunque la conversación
// previa ya esté CLOSED — quien decide si hace falta una Conversation nueva es
// findOpenConversation, que runAgentTurn llama después con el contactId ya
// resuelto. Ver widgetContact.service.ts.
//
// SOLO con el contacto vivo (C-04/C-14 de
// docs-privados/auditoria-2026-09-30-corta.md, local): si el contacto de esa
// sesión se borró —a mano o por la purga de "Visitante"—, devolverlo dejaba
// la sesión del widget muerta para siempre (runAgentTurn responde 400 "el
// contacto no existe" en cada mensaje). Ignorándola, la sesión arranca de
// cero con un contacto nuevo, como un visitante nuevo.
export function findConversationByExternalThreadId(
  organizationId: string,
  agentId: string,
  channel: ConversationChannel,
  externalThreadId: string,
  db: Db = prisma,
) {
  return db.conversation.findFirst({
    where: {
      organizationId,
      agentId,
      channel,
      externalThreadId,
      contact: { is: { deletedAt: null } },
    },
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
