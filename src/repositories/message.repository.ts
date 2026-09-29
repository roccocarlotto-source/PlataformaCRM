import type {
  MessageDeliveryStatus,
  MessageDirection,
  MessageSenderType,
  Prisma,
} from "@prisma/client";
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
  // F1: el WhatsApp de una automatización se registra ya enviado (SENT).
  deliveryStatus?: MessageDeliveryStatus;
}

export function createMessage(data: CreateMessageData, db: Db = prisma) {
  return db.message.create({ data });
}

// Dedup del webhook de WhatsApp (ítem 81): ¿ya se registró este id de mensaje
// del canal en esta organización? El UNIQUE (organizationId,
// externalMessageId) es la garantía real; esto es el atajo del caso común
// (Meta reintentando una entrega que ya se procesó), para no llegar a crear un
// contacto ni a abrir un turno por un mensaje repetido.
export function findMessageByExternalId(
  organizationId: string,
  externalMessageId: string,
  db: Db = prisma,
) {
  return db.message.findFirst({
    where: { organizationId, externalMessageId },
    select: { id: true },
  });
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

// ¿Ya intervino una persona de la organización en este hilo? (ítem 83). Es el
// gate del loop del agente: mientras la respuesta sea `false`, el agente
// contesta; desde el primer mensaje HUMAN, se calla.
//
// EL HILO ENTERO Y NO LA VENTANA DE CONTEXTO: findLastMessages trae los
// últimos 20, y un humano que escribió hace 21 mensajes intervino igual. Es
// una consulta aparte por eso, no por no poder reusar la otra.
//
// findFirst + select id: alcanza con saber si existe alguno. Sirve el mismo
// índice (conversation_id, created_at) que el resto de las lecturas de esta
// tabla — filtra por el prefijo y descarta por senderType sobre las pocas
// filas de una conversación.
export async function hasHumanMessage(
  conversationId: string,
  organizationId: string,
  db: Db = prisma,
): Promise<boolean> {
  const humano = await db.message.findFirst({
    where: { conversationId, organizationId, senderType: "HUMAN" },
    select: { id: true },
  });
  return humano !== null;
}

export function findMessageById(id: string, organizationId: string, db: Db = prisma) {
  return db.message.findFirst({ where: { id, organizationId } });
}

// Estado de entrega de un saliente por un canal externo (ítem 125, B-02).
// SENT limpia el error de un intento anterior: un mensaje entregado no
// arrastra el diagnóstico de un fallo que ya no describe nada (mismo criterio
// que markOutboxEventProcessed con lastError).
//
// `externalMessageId` (WA-1 de los pendientes post F1–F5): el wamid que Meta
// devolvió al aceptar el envío. Se guarda junto con el SENT para que los
// statuses del webhook (DELIVERED/READ) encuentren el mensaje. Hasta WA-1 solo
// lo guardaban las plantillas de F1; las respuestas del agente lo tiraban.
export function markMessageDelivery(
  id: string,
  organizationId: string,
  entrega: {
    status: MessageDeliveryStatus;
    error?: string | null;
    externalMessageId?: string | null;
  },
  db: Db = prisma,
) {
  return db.message.updateMany({
    where: { id, organizationId },
    data: {
      deliveryStatus: entrega.status,
      deliveryError: entrega.status === "SENT" ? null : (entrega.error ?? null),
      ...(entrega.externalMessageId ? { externalMessageId: entrega.externalMessageId } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Statuses de Meta (WA-1 de los pendientes post F1–F5, docs/prueba-en-vivo-
// 2026-09-29.md): sent / delivered / read / failed de un wamid saliente.
//
// EL ESTADO NUNCA RETROCEDE. Meta no garantiza el orden de entrega de los
// statuses (un "read" puede llegar antes que su "delivered") y además
// reintenta, así que la escritura es un UPDATE condicional: solo se aplica si
// el estado actual está ANTES en el orden. Eso la hace idempotente (el mismo
// status dos veces actualiza 0 filas la segunda) y resistente al desorden, sin
// leer antes: no hay ventana entre la lectura y la escritura.
//
// El orden: PENDING < SENT < FAILED < DELIVERED < READ. FAILED va antes de
// DELIVERED porque si Meta después dice que se entregó, se entregó; un
// "failed" que llega después de un "read" es ruido.
//
// Aislamiento: organizationId en el WHERE (el wamid es único POR
// organización), y solo salientes: un wamid entrante nunca recibe statuses.
// Un wamid desconocido actualiza 0 filas, sin error.
// ---------------------------------------------------------------------------
const ORDEN_DE_ENTREGA: MessageDeliveryStatus[] = [
  "PENDING",
  "SENT",
  "FAILED",
  "DELIVERED",
  "READ",
];

// Los estados desde los que se puede pasar a `destino`. Exportada para
// fijarla con tests sin base.
export function estadosQueAvanzanA(destino: MessageDeliveryStatus): MessageDeliveryStatus[] {
  return ORDEN_DE_ENTREGA.slice(0, ORDEN_DE_ENTREGA.indexOf(destino));
}

export function applyDeliveryStatusByExternalId(
  organizationId: string,
  externalMessageId: string,
  entrega: { status: "SENT" | "DELIVERED" | "READ" | "FAILED"; error?: string | null },
  db: Db = prisma,
) {
  return db.message.updateMany({
    where: {
      organizationId,
      externalMessageId,
      direction: "OUTBOUND",
      // NULL también avanza: un saliente anterior a B-02 no tiene estado.
      OR: [
        { deliveryStatus: null },
        { deliveryStatus: { in: estadosQueAvanzanA(entrega.status) } },
      ],
    },
    data: {
      deliveryStatus: entrega.status,
      deliveryError: entrega.status === "FAILED" ? (entrega.error ?? null) : null,
    },
  });
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
