import type { MessageDirection, MessageSenderType, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// Mensajes de una conversación del módulo de Agentes de IA. El único patrón de
// lectura es "los mensajes de una conversación, en orden" (índice
// [conversationId, createdAt] del schema): no hay listado por organización.

export interface CreateMessageData {
  organizationId: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderUserId?: string;
  content: string;
  // Auditoría del turno (§6): qué tool intentó usar el agente, con qué
  // argumentos, si puedeEjecutarTool la permitió y qué devolvió. Forma libre.
  toolCalls?: Prisma.InputJsonValue;
  externalMessageId?: string;
}

export function createMessage(data: CreateMessageData, db: Db = prisma) {
  return db.message.create({ data });
}

// Los ÚLTIMOS `take` mensajes de la conversación, devueltos en orden
// cronológico (del más viejo al más nuevo), que es como se le pasan al modelo.
// Se leen al revés (desc + take) y se invierten: es la forma de "los últimos N"
// que no exige contar primero. Ventana de contexto de §10: 20, truncado simple.
export async function findLastMessages(
  conversationId: string,
  organizationId: string,
  take: number,
  db: Db = prisma,
) {
  const ultimos = await db.message.findMany({
    where: { conversationId, organizationId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return ultimos.reverse();
}

export function findMessagesByConversation(
  conversationId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.message.findMany({
    where: { conversationId, organizationId },
    orderBy: { createdAt: "asc" },
  });
}
