import type { ConversationChannel, ConversationStatus } from "@prisma/client";
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
