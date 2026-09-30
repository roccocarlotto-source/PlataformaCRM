import type { InternalAgentMessageSenderType, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// El agente de IA interno (ítem 179): su configuración —un registro por
// organización— y el hilo de mensajes de cada usuario. organizationId en todos
// los WHERE, como en el resto de los repositorios.
// ---------------------------------------------------------------------------

export function findInternalAgentByOrganization(organizationId: string, db: Db = prisma) {
  return db.internalAgent.findUnique({ where: { organizationId } });
}

export interface InternalAgentConfigData {
  name: string;
  instructions: string;
  modelProvider: string;
  modelName: string;
  enabledTools: string[];
}

// Un solo registro por organización (@@unique), así que el PUT es un upsert
// por organizationId: crea la primera vez, reemplaza las siguientes.
export function upsertInternalAgent(
  organizationId: string,
  data: InternalAgentConfigData,
  db: Db = prisma,
) {
  return db.internalAgent.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
}

// El modelo del agente interno, SOLO desde el endpoint de platform admin
// (B-05 de docs-privados/auditoria-2026-09-24-punta-a-punta.md, local).
export function setInternalAgentModel(
  organizationId: string,
  model: { modelProvider: string; modelName: string },
  db: Db = prisma,
) {
  return db.internalAgent.updateMany({ where: { organizationId }, data: model });
}

export interface CreateInternalAgentMessageData {
  organizationId: string;
  internalAgentId: string;
  userId: string;
  senderType: InternalAgentMessageSenderType;
  content: string;
  toolCalls?: Prisma.InputJsonValue;
}

export function createInternalAgentMessage(data: CreateInternalAgentMessageData, db: Db = prisma) {
  return db.internalAgentMessage.create({ data });
}

function whereDelHilo(organizationId: string, internalAgentId: string, userId: string) {
  return { organizationId, internalAgentId, userId };
}

// Los últimos `take` mensajes del hilo, devueltos en orden cronológico (el
// orden en que se le pasan al modelo). Mismo truco que findLastMessages: se
// leen de atrás para adelante y se invierten.
export async function findLastInternalAgentMessages(
  organizationId: string,
  internalAgentId: string,
  userId: string,
  take: number,
  db: Db = prisma,
) {
  const ultimos = await db.internalAgentMessage.findMany({
    where: whereDelHilo(organizationId, internalAgentId, userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  return ultimos.reverse();
}

// El GET paginado del historial: lo más nuevo primero, como cualquier chat que
// carga hacia atrás.
export function findInternalAgentMessages(
  organizationId: string,
  internalAgentId: string,
  userId: string,
  pagination: { skip: number; take: number },
  db: Db = prisma,
) {
  return db.internalAgentMessage.findMany({
    where: whereDelHilo(organizationId, internalAgentId, userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countInternalAgentMessages(
  organizationId: string,
  internalAgentId: string,
  userId: string,
  db: Db = prisma,
) {
  return db.internalAgentMessage.count({
    where: whereDelHilo(organizationId, internalAgentId, userId),
  });
}

// Los nombres que get_agenda necesita para resumir los turnos: listBookings
// devuelve ids. Sin filtro de deletedAt a propósito: un turno viejo de un
// servicio o una sucursal dados de baja sigue siendo un turno que existió, y
// tiene que mostrarse con su nombre.
export async function findEtiquetasDeAgenda(
  organizationId: string,
  ids: { contactIds: string[]; serviceTypeIds: string[]; branchIds: string[] },
  db: Db = prisma,
) {
  const [contactos, servicios, sucursales] = await Promise.all([
    db.contact.findMany({
      where: { organizationId, id: { in: ids.contactIds } },
      select: { id: true, firstName: true, lastName: true },
    }),
    db.serviceType.findMany({
      where: { organizationId, id: { in: ids.serviceTypeIds } },
      select: { id: true, name: true },
    }),
    db.branch.findMany({
      where: { organizationId, id: { in: ids.branchIds } },
      select: { id: true, name: true, timezone: true },
    }),
  ]);
  return { contactos, servicios, sucursales };
}
