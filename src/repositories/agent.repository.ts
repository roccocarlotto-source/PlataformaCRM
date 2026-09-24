import type { ConversationChannel, Prisma } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

export interface AgentFilters {
  search?: string;
  branchId?: string;
  isActive?: boolean;
}

export type AgentSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// organizationId siempre obligatorio y deletedAt: null siempre presente en
// lecturas — el único lugar donde se arma el filtro multi-tenant + soft delete
// para esta entidad, para que findMany/count nunca puedan divergir. Mismo
// patrón que resource.repository.ts.
function buildWhere(organizationId: string, filters: AgentFilters): Prisma.AgentWhereInput {
  return {
    organizationId,
    deletedAt: null,
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
  };
}

function buildOrderBy(
  sortBy: AgentSortBy,
  sortOrder: SortOrder,
): Prisma.AgentOrderByWithRelationInput {
  switch (sortBy) {
    case "name":
      return { name: sortOrder };
    case "createdAt":
    default:
      return { createdAt: sortOrder };
  }
}

export function findManyAgents(
  organizationId: string,
  filters: AgentFilters,
  pagination: { skip: number; take: number },
  sort: { sortBy: AgentSortBy; sortOrder: SortOrder },
  db: Db = prisma,
) {
  return db.agent.findMany({
    where: buildWhere(organizationId, filters),
    orderBy: buildOrderBy(sort.sortBy, sort.sortOrder),
    skip: pagination.skip,
    take: pagination.take,
  });
}

export function countAgents(organizationId: string, filters: AgentFilters, db: Db = prisma) {
  return db.agent.count({ where: buildWhere(organizationId, filters) });
}

export function findAgentById(id: string, organizationId: string, db: Db = prisma) {
  return db.agent.findFirst({ where: { id, organizationId, deletedAt: null } });
}

// SIN organizationId, A PROPÓSITO — la única lectura de este archivo sin él.
// La usa el CORS dinámico del widget (middlewares/widgetCors.ts) al resolver
// el preflight OPTIONS de POST /api/public/agents/:agentId/web/messages: en
// ese momento no hay token (un preflight nunca lo trae) y por lo tanto no se
// conoce la organización; lo único que hay es el :agentId público de la URL.
// Y allowedOrigins no es un dato sensible: es exactamente lo que un preflight
// de CORS existe para revelar por diseño (el navegador se lo muestra a
// cualquiera que haga el OPTIONS). Devuelve SOLO eso, para que esta función
// no pueda convertirse en un camino de lectura de nada más del agente.
// deletedAt: null — un agente borrado no refleja ningún origen.
export function findAgentOriginsById(agentId: string, db: Db = prisma) {
  return db.agent.findFirst({
    where: { id: agentId, deletedAt: null },
    select: { allowedOrigins: true },
  });
}

// SIN organizationId, A PROPÓSITO — igual que findAgentOriginsById y por el
// mismo motivo: el webhook de WhatsApp (ítem 81) llega de Meta sin sesión ni
// token nuestro, y lo único que dice a quién le corresponde el mensaje es el
// phone_number_id del payload. La organización SALE de acá, no entra. Es
// seguro porque el request ya pasó la firma HMAC de Meta (solo Meta puede
// mandar un phone_number_id) y porque la columna es UNIQUE global. Devuelve
// solo lo que el webhook necesita para decidir si atiende.
export function findAgentByWhatsappPhoneNumberId(phoneNumberId: string, db: Db = prisma) {
  return db.agent.findFirst({
    where: { whatsappPhoneNumberId: phoneNumberId, deletedAt: null },
    select: { id: true, organizationId: true, isActive: true, channels: true },
  });
}

export interface CreateAgentData {
  organizationId: string;
  branchId: string;
  name: string;
  goal?: string | null;
  instructions: string;
  tone?: string | null;
  modelProvider: string;
  modelName: string;
  enabledTools: string[];
  channels: ConversationChannel[];
  guardrails: Prisma.InputJsonValue;
  // El mismo límite, en las palabras del ADMIN (ítem 56). Texto plano, sin
  // cast: no es Json. NOT NULL con default '' en la base, así que omitirlo
  // dejaría "" — pero el service siempre lo manda, porque el borde lo exige.
  guardrailsText: string;
  // Ya normalizados por utils/origin.ts. Vacío = widget deshabilitado.
  allowedOrigins?: string[];
  // Sin whatsappPhoneNumberId, a propósito (ítem 127, A-01 de
  // docs/auditoria-2026-09-24-punta-a-punta.md): un agente nace sin número y
  // el número lo escribe SOLO setAgentWhatsappPhoneNumberId, desde el endpoint
  // de platform admin. Que no esté en el tipo es lo que impide que un camino
  // del tenant lo escriba.
  isActive?: boolean;
}

export function createAgent(data: CreateAgentData, db: Db = prisma) {
  return db.agent.create({ data });
}

// Sin branchId: un Agent NO cambia de sucursal. Ver la nota en
// agent.service.ts sobre por qué es inmutable.
export interface UpdateAgentData {
  name?: string;
  goal?: string | null;
  instructions?: string;
  tone?: string | null;
  modelProvider?: string;
  modelName?: string;
  enabledTools?: string[];
  channels?: ConversationChannel[];
  allowedOrigins?: string[];
  // Sin whatsappPhoneNumberId: ver CreateAgentData.
  // Se reemplaza entero, nunca se mergea: guardrails es NOT NULL sin default
  // en el schema, así que acá no hay DbNull que contemplar.
  guardrails?: Prisma.InputJsonValue;
  // Se actualiza SIEMPRE junto con guardrails — updateAgentSchema lo exige.
  guardrailsText?: string;
  isActive?: boolean;
}

// updateMany en vez de update: el WHERE efectivo tiene que exigir
// organizationId además de id (M4) — la escritura en sí es la garantía de
// aislamiento, no solo el pre-check del service. count === 0 se traduce a 404.
export function updateAgent(
  id: string,
  organizationId: string,
  data: UpdateAgentData,
  db: Db = prisma,
) {
  return db.agent.updateMany({ where: { id, organizationId, deletedAt: null }, data });
}

// SIN organizationId, A PROPÓSITO — las dos de abajo son del endpoint de
// platform admin que asigna el número de WhatsApp (ítem 127): quien llama no
// es parte de la organización del agente, y la autorización ya la hizo
// requirePlatformAdmin. deletedAt: null — a un agente borrado no se le asigna
// nada (y el borrado ya le liberó el número).
export function findAgentByIdForPlatformAdmin(id: string, db: Db = prisma) {
  return db.agent.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, organizationId: true, whatsappPhoneNumberId: true },
  });
}

// El ÚNICO camino que escribe whatsapp_phone_number_id (fuera del borrado, que
// lo vacía). null libera el número. El UNIQUE global de la columna es lo que
// resuelve dos asignaciones concurrentes del mismo número: la segunda es P2002.
export function setAgentWhatsappPhoneNumberId(
  id: string,
  whatsappPhoneNumberId: string | null,
  db: Db = prisma,
) {
  return db.agent.updateMany({ where: { id, deletedAt: null }, data: { whatsappPhoneNumberId } });
}

export function softDeleteAgent(id: string, organizationId: string, db: Db = prisma) {
  return db.agent.updateMany({
    where: { id, organizationId, deletedAt: null },
    // El número de WhatsApp se libera junto con el borrado (ítem 81): la
    // columna es UNIQUE global, y un agente borrado que lo retuviera impediría
    // pasárselo al agente que lo reemplaza. Un borrado lógico no tiene por qué
    // seguir reservando un recurso externo.
    data: { deletedAt: new Date(), whatsappPhoneNumberId: null },
  });
}
